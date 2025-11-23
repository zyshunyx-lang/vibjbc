const { Client } = require('pg');

exports.handler = async (event, context) => {
    // 1. 配置数据库连接
    // 我们显式添加了 ssl: { rejectUnauthorized: false }，这是连接 Neon 的关键修复
    const client = new Client({
        connectionString: "postgresql://neondb_owner:npg_6sEnYkdHTB2F@ep-wandering-river-ae139vmt-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require",
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        // 尝试连接
        await client.connect();

        const payload = JSON.parse(event.body || '{}');
        const { action, password, newData, newAdminPass, newViewPass } = payload;

        // --- 获取当前配置 ---
        // 注意：如果是第一次运行，数据库可能是空的，我们加一个容错处理
        let dbRow, currentData;
        try {
            const res = await client.query('SELECT * FROM system_config WHERE id = 1');
            if (res.rows.length === 0) {
                // 如果表存在但没数据，初始化它
                await client.query("INSERT INTO system_config (id, data, admin_pass, view_pass) VALUES (1, '{}', 'admin888', 'view666')");
                dbRow = { data: {}, admin_pass: 'admin888', view_pass: 'view666' };
            } else {
                dbRow = res.rows[0];
            }
            currentData = dbRow.data || {};
        } catch (err) {
             // 如果连表都不存在（第一次），这里会报错，我们尝试建表
             console.log("表可能不存在，尝试创建...", err.message);
             await client.query(`
                CREATE TABLE IF NOT EXISTS system_config (
                    id INT PRIMARY KEY,
                    data JSONB,
                    admin_pass TEXT,
                    view_pass TEXT
                );
             `);
             await client.query("INSERT INTO system_config (id, data, admin_pass, view_pass) VALUES (1, '{}', 'admin888', 'view666') ON CONFLICT (id) DO NOTHING");
             // 重新获取
             const resRetry = await client.query('SELECT * FROM system_config WHERE id = 1');
             dbRow = resRetry.rows[0];
             currentData = dbRow.data || {};
        }

        // --- 验证逻辑 ---
        
        // A. 登录 / 读取数据
        if (action === 'login') {
            if (password === dbRow.admin_pass) {
                return { statusCode: 200, body: JSON.stringify({ role: 'admin', data: currentData }) };
            } else if (password === dbRow.view_pass) {
                return { statusCode: 200, body: JSON.stringify({ role: 'viewer', data: currentData }) };
            } else {
                return { statusCode: 401, body: JSON.stringify({ error: '密码错误' }) };
            }
        }

        // B. 发布数据 (保存排班表)
        if (action === 'save') {
            if (password !== dbRow.admin_pass) return { statusCode: 403, body: "无权操作" };
            await client.query('UPDATE system_config SET data = $1 WHERE id = 1', [newData]);
            return { statusCode: 200, body: JSON.stringify({ success: true }) };
        }

        // C. 修改密码
        if (action === 'change_pass') {
            if (password !== dbRow.admin_pass) return { statusCode: 403, body: "无权操作" };
            if (newAdminPass) await client.query('UPDATE system_config SET admin_pass = $1 WHERE id = 1', [newAdminPass]);
            if (newViewPass) await client.query('UPDATE system_config SET view_pass = $1 WHERE id = 1', [newViewPass]);
            return { statusCode: 200, body: JSON.stringify({ success: true }) };
        }

        return { statusCode: 400, body: "未知操作" };

    } catch (error) {
        console.error("Database Error:", error);
        return { statusCode: 500, body: "Server Error: " + error.message };
    } finally {
        await client.end();
    }
};
