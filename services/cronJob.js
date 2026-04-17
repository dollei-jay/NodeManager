const { readDb, writeDb } = require('../utils/db');
const { sendToAdmin } = require('./telegramService');

// 将日期对象转换为本地 YYYY-MM-DD 字符串
function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function parseLocalDate(dateStr) {
    if (!dateStr) return new Date();
    const parts = dateStr.split('-');
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

function getLocalToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getNextExpireDate(sub) {
    const today = getLocalToday();
    const expireDate = parseLocalDate(sub.expireDate);

    // 如果未到期，直接返回
    if (expireDate >= today) {
        return expireDate;
    }

    // 已到期且无重复规则，返回原始到期日
    if (!sub.repeat || sub.repeat === 'never') {
        return expireDate;
    }

    let nextDate = new Date(expireDate);
    while (nextDate < today) {
        switch (sub.repeat) {
            case 'daily': nextDate.setDate(nextDate.getDate() + 1); break;
            case 'weekly': nextDate.setDate(nextDate.getDate() + 7); break;
            case 'monthly': nextDate.setMonth(nextDate.getMonth() + 1); break;
            case 'yearly': nextDate.setFullYear(nextDate.getFullYear() + 1); break;
            default: return expireDate;
        }
    }
    return nextDate;
}

const checkAndNotify = async () => {
    console.log(`[Cron] [${new Date().toLocaleString()}] 正在检查订阅到期情况...`);
    
    try {
        const db = readDb();
        if (!db.subscriptions || db.subscriptions.length === 0) {
            console.log('[Cron] 没有发现任何订阅数据。');
            return;
        }

        const today = getLocalToday();
        let notifyCount = 0;

        for (const sub of db.subscriptions) {
            const nextDate = getNextExpireDate(sub);
            const nextDateStr = formatDate(nextDate);
            
            const diffTime = nextDate - today;
            const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            const threshold = sub.notifyDays || 7;

            console.log(`[Cron] 检查项目: ${sub.name}, 剩余: ${daysLeft}天, 阈值: ${threshold}天`);

            // 如果在提醒范围内（包含已经过期的情况）
            if (daysLeft <= threshold) {
                let statusIcon = '🔔';
                let statusText = `剩余 ${daysLeft} 天`;

                if (daysLeft < 0) {
                    statusIcon = '🚨 已过期';
                    statusText = `已过期 ${Math.abs(daysLeft)} 天`;
                } else if (daysLeft === 0) {
                    statusIcon = '🚨 今天到期';
                    statusText = '今天到期';
                } else if (daysLeft <= 3) {
                    statusIcon = '⚠️ 即将到期';
                }

                const message = [
                    `${statusIcon} **自动推送：订阅状态提醒**`,
                    `------------------`,
                    `📌 **服务名称**: ${sub.name}`,
                    `📅 **当前到期日**: ${nextDateStr}`,
                    `⏰ **当前状态**: ${statusText}`,
                    `📝 **备注**: ${sub.note || '无'}`,
                    `------------------`,
                    daysLeft < 0 ? `❗ 服务可能已经中断，请尽快处理。` : `请确认是否续费，如已续费请在系统中更新日期。`
                ].join('\n');

                try {
                    await sendToAdmin(message);
                    notifyCount++;
                    console.log(`[Cron] 通知已发出: ${sub.name}`);
                } catch (err) {
                    console.error(`[Cron] 发送通知失败 (${sub.name}):`, err.message);
                }
            }
        }
        console.log(`[Cron] 检查结束。本次共推送 ${notifyCount} 条消息。`);
    } catch (e) {
        console.error('[Cron] 任务运行出错:', e);
    }
};

module.exports = checkAndNotify;