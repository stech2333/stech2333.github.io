import { createClient } from '@supabase/supabase-js';
import readline from 'node:readline';

function ask(question) {
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => input.question(question, answer => { input.close(); resolve(answer.trim()); }));
}

function askSecret(question) {
  if (!process.stdin.isTTY) throw new Error('请在交互式终端中运行，以免密码显示在屏幕上。');
  process.stdout.write(question);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let answer = '';
    function finish(error) {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(answer);
    }
    function onData(chunk) {
      for (const char of chunk) {
        if (char === '\u0003') return finish(new Error('操作已取消。'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') answer = answer.slice(0, -1);
        else if (char >= ' ') answer += char;
      }
    }
    process.stdin.on('data', onData);
  });
}

async function main() {
  const url = (await ask('Supabase 项目 URL：')).trim().replace(/\/$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) throw new Error('项目 URL 格式不正确。');
  const key = (await askSecret('当前项目的 sb_secret_... key（输入不显示）：')).trim();
  if (key.startsWith('sb_publishable_')) throw new Error('这里需要 sb_secret_...，不能使用 sb_publishable_...。');
  if (!key.startsWith('sb_secret_') && !key.startsWith('eyJ')) throw new Error('请从当前项目的 Settings → API Keys 复制 secret key，不要复制项目 URL 或数据库密码。');
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const check = await client.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (check.error?.message === 'fetch failed') throw new Error('无法连接 Supabase（fetch failed）。如果通过代理联网，请使用 Node.js 24.5+ 并在运行前设置 $env:NODE_USE_ENV_PROXY="1"。');
  if (check.error) throw new Error('密钥验证失败：' + check.error.message + '。请确认 URL 与 secret key 来自同一个 Supabase 项目。');
  process.stdout.write('项目 URL 与管理密钥已验证。\n');
  const email = (await ask('唯一管理员邮箱：')).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('邮箱格式不正确。');
  const password = await askSecret('设置登录密码（至少 12 位，输入不显示）：');
  const confirmation = await askSecret('再次输入密码：');
  if (password.length < 12 || password !== confirmation) throw new Error('密码长度不足或两次输入不一致。');

  const created = await client.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const registered = await client.rpc('set_draft_owner', { owner_uuid: created.data.user.id });
  if (registered.error) throw new Error('账号已创建，但登记草稿所有者失败：' + registered.error.message);
  process.stdout.write('唯一草稿账号已创建并登记。用户 ID：' + created.data.user.id + '\n');
  process.stdout.write('请关闭 Supabase 的公开注册，并把项目 URL 与 publishable key 写入 js/drafts-config.js。\n');
}

main().catch(error => { process.stderr.write('初始化失败：' + error.message + '\n'); process.exitCode = 1; });
