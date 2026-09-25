# 私人草稿空间初始化

草稿已整合进 `/study/#docs`。公开站点仅包含编辑器代码和 Supabase publishable key；账号密码、secret key 和私人数据不得提交到公开仓库。

## 学习空间升级

已有草稿空间的项目先在 Supabase SQL Editor 执行 `study-schema.sql`。它只增加学习计划、任务和 LeetCode 记录表及访问规则，不改动原草稿表或唯一管理员账号。执行成功后刷新 `/study/`，用原管理员邮箱和密码登录。日历、学习计划、任务、题目链接、Markdown 题解和原草稿都会从私人数据库读取。右键点击项目可编辑或删除；手机或触屏可点项目旁的小 `⋯`。删除计划时任务会转到“未分类”，删除任务、题目或文档会软删除。

新项目仍应先执行 `schema.sql` 并登记唯一所有者，再执行 `study-schema.sql`。站点的 publishable key 继续放在 `js/drafts-config.js`，不要把 secret key 写入网页。`/drafts/` 会跳转到 `/study/#docs`。

## 1. 创建项目与数据库

1. 由站长本人创建 Supabase 项目，从项目的 Connect 面板取得项目 URL 与 publishable key，从 Settings → API Keys 取得 `sb_secret_...` secret key。妥善保存管理密钥和数据库连接信息。
2. 在项目 SQL Editor 执行本目录的 `schema.sql`。也可以在已配置安全数据库连接的终端使用 `psql -f schema.sql`。这个脚本创建草稿表、历史版本、私有文件桶和仅限唯一所有者的权限规则。
3. 在 Supabase Auth 设置中保留邮箱密码登录，关闭 **Allow new users to sign up** 与匿名登录。

## 2. 在终端创建唯一账号

准备 Node.js 22 或更新版本，在本目录执行：

```powershell
npm install
npm run setup-owner
```

如果终端通过代理联网，Node.js 24.5+ 需要先启用环境代理支持，再运行脚本：

```powershell
$env:NODE_USE_ENV_PROXY = '1'
npm run setup-owner
```

出现 `fetch failed` 是连接问题，不能据此判断密钥是否正确。请勿通过关闭 TLS 证书验证来处理连接问题。

脚本会依次询问项目 URL、当前项目的 `sb_secret_...` key、邮箱；仅在邮箱尚无账号时询问密码并创建账号。它会先只读验证 URL 和密钥。密钥和密码输入时不会显示，也无需写入命令参数。请本人在自己的终端运行；不要把执行过程录屏或上传日志。

如果提示 `Could not find the function public.set_draft_owner(owner_uuid) in the schema cache`，请先在 SQL Editor 完整执行本目录的 `schema.sql`，确认执行成功，再重新运行 `npm run setup-owner`。SQL 文件可以重跑；脚本会找到已创建的邮箱账号并继续登记，不会重设密码。如果确认数据库中已存在函数而接口仍找不到，请在 SQL Editor 执行 `NOTIFY pgrst, 'reload schema';` 后重试。

## 3. 连接网页

把项目 URL 和 **publishable key** 填入站点中的 `js/drafts-config.js`；本地 Hexo 源文件为 `hexo/source/js/drafts-config.js`。这个 key 可以出现在浏览器中；安全性依赖 `schema.sql` 中的数据库与私有存储权限。**不要**填写 secret key。

上线后依次验证：未登录看不到草稿；唯一账号能够登录、新建草稿、用 Markdown 写作、最后命名、自动保存、下载 `.md` 和删除草稿；其他账号即使能够登录 Supabase，也不能读取或写入草稿。

## 内容与发布

草稿正文使用 Markdown。新建后直接写正文，草稿名称可以最后填写；输入会自动保存，也可以手动保存或下载为 `.md` 文件。数据库仍保留旧版草稿的结构，打开旧草稿时会转换成 Markdown 文本；旧附件路径以 `draft-asset://` 形式保留，下载后的文件如需公开使用，应自行替换为可访问的文件地址。删除操作会从列表隐藏草稿，数据库保留原记录以防误删。

当前版本只管理私人草稿，不会自动发布到公开 Hexo 文章。公开站点的 Markdown 文件与私人草稿需分别管理。
