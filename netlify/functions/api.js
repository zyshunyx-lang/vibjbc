const { Client } = require('pg');

exports.handler = async (event, context) => {
    // 1. 安全配置：从环境变量读取连接串
    // 我们手动添加 ssl 配置，确保能连上 Neon
    const client = new Client({
   // 优先使用 Netlify 自动生成的连接池地址，如果没有则回退到手动地址
connectionString: process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false // 关键设置：允许 Neon 的 SSL 连接
        }
    });

    try {
        await client.connect();

        // 自动建表与初始化 (防止第一次运行报错)
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS system_config (
                    id INT PRIMARY KEY,
                    data JSONB,
                    admin_pass TEXT,
                    view_pass TEXT
                );
            `);
            // 初始化默认密码
            await client.query("INSERT INTO system_config (id, data, admin_pass, view_pass) VALUES (1, '{}', 'admin888', 'view666') ON CONFLICT (id) DO NOTHING");
        } catch (e) {
            console.log("初始化检查跳过:", e.message);
        }

        const payload = JSON.parse(event.body || '{}');
        const { action, password, newData, newAdminPass, newViewPass } = payload;

        // 获取当前数据
        const res = await client.query('SELECT * FROM system_config WHERE id = 1');
        const dbRow = res.rows[0] || { admin_pass: 'admin888', view_pass: 'view666', data: {} };

        // 业务逻辑
        if (action === 'login') {
            if (password === dbRow.admin_pass) {
                return { statusCode: 200, body: JSON.stringify({ role: 'admin', data: dbRow.data }) };
            } else if (password === dbRow.view_pass) {
                return { statusCode: 200, body: JSON.stringify({ role: 'viewer', data: dbRow.data }) };
            }
            return { statusCode: 401, body: JSON.stringify({ error: '密码错误' }) };
        }

        if (action === 'save') {
            if (password !== dbRow.admin_pass) return { statusCode: 403, body: "无权操作" };
            await client.query('UPDATE system_config SET data = $1 WHERE id = 1', [newData]);
            return { statusCode: 200, body: JSON.stringify({ success: true }) };
        }

        if (action === 'change_pass') {
            if (password !== dbRow.admin_pass) return { statusCode: 403, body: "无权操作" };
            if (newAdminPass) await client.query('UPDATE system_config SET admin_pass = $1 WHERE id = 1', [newAdminPass]);
            if (newViewPass) await client.query('UPDATE system_config SET view_pass = $1 WHERE id = 1', [newViewPass]);
            return { statusCode: 200, body: JSON.stringify({ success: true }) };
        }

        return { statusCode: 400, body: "未知操作" };

    } catch (error) {
        return { statusCode: 500, body: "Database Error: " + error.message };
    } finally {
        await client.end();
    }
};
