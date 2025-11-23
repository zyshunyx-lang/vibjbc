import { Client } from '@neondatabase/serverless';

export async function onRequest(context) {
    // 1. 获取数据库连接串 (从环境变量)
    const connectionString = context.env.DATABASE_URL;

    if (!connectionString) {
        return new Response("Database config missing", { status: 500 });
    }

    // 2. 连接 Neon 数据库 (使用 serverless 驱动)
    const client = new Client(connectionString);
    await client.connect();

    try {
        // 读取请求内容
        const req = context.request;
        const payload = await req.json();
        const { action, password, newData, newAdminPass, newViewPass } = payload;

        // --- 自动建表逻辑 (首次运行) ---
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS system_config (
                    id INT PRIMARY KEY,
                    data JSONB,
                    admin_pass TEXT,
                    view_pass TEXT
                );
            `);
            // 初始化默认密码: admin888 / view666
            await client.query(`
                INSERT INTO system_config (id, data, admin_pass, view_pass) 
                VALUES (1, '{}', 'admin888', 'view666') 
                ON CONFLICT (id) DO NOTHING
            `);
        } catch (e) {
            console.log("Init skipped:", e);
        }

        // --- 获取当前数据 ---
        const { rows } = await client.query('SELECT * FROM system_config WHERE id = 1');
        const dbRow = rows[0] || { admin_pass: 'admin888', view_pass: 'view666', data: {} };

        // --- 业务逻辑 ---
        
        // A. 登录
        if (action === 'login') {
            if (password === dbRow.admin_pass) {
                return new Response(JSON.stringify({ role: 'admin', data: dbRow.data }), { status: 200 });
            } else if (password === dbRow.view_pass) {
                return new Response(JSON.stringify({ role: 'viewer', data: dbRow.data }), { status: 200 });
            }
            return new Response(JSON.stringify({ error: '密码错误' }), { status: 401 });
        }

        // B. 保存
        if (action === 'save') {
            if (password !== dbRow.admin_pass) return new Response("无权操作", { status: 403 });
            await client.query('UPDATE system_config SET data = $1 WHERE id = 1', [newData]);
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        }

        // C. 修改密码
        if (action === 'change_pass') {
            if (password !== dbRow.admin_pass) return new Response("无权操作", { status: 403 });
            if (newAdminPass) await client.query('UPDATE system_config SET admin_pass = $1 WHERE id = 1', [newAdminPass]);
            if (newViewPass) await client.query('UPDATE system_config SET view_pass = $1 WHERE id = 1', [newViewPass]);
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        }

        return new Response("未知操作", { status: 400 });

    } catch (error) {
        return new Response("Server Error: " + error.message, { status: 500 });
    } finally {
        // 必须关闭连接，不然会耗尽资源
        context.waitUntil(client.end());
    }
}
