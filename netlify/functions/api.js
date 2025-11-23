const { Client } = require('pg');

exports.handler = async (event, context) => {
    // 1. 获取数据库连接串 (在 Netlify 环境变量中设置，或暂时硬编码测试)
    const connectionString = process.env.DATABASE_URL; 
    
    if (!connectionString) return { statusCode: 500, body: "Missing Database Config" };

    const client = new Client({ connectionString });
    await client.connect();

    try {
        const payload = JSON.parse(event.body || '{}');
        const { action, password, newData, newAdminPass, newViewPass } = payload;

        // --- 获取当前配置 ---
        const res = await client.query('SELECT * FROM system_config WHERE id = 1');
        const dbRow = res.rows[0];
        const currentData = dbRow.data || {};

        // --- 验证逻辑 ---
        
        // A. 登录 / 读取数据
        if (action === 'login') {
            if (password === dbRow.admin_pass) {
                // 管理员：返回全部数据 + 身份标识
                return { statusCode: 200, body: JSON.stringify({ role: 'admin', data: currentData }) };
            } else if (password === dbRow.view_pass) {
                // 普通查看：返回数据，但可以在这里过滤敏感字段(如果有)
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
        return { statusCode: 500, body: String(error) };
    } finally {
        await client.end();
    }
};
