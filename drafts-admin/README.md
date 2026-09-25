# 私人草稿空间初始化

草稿页面位于 `/drafts/`。公开站点仅包含编辑器代码和 Supabase publishable key；账号密码、secret key 和草稿数据不得提交到公开仓库。

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

脚本会依次询问项目 URL、当前项目的 `sb_secret_...` key、邮箱、密码。它会先只读验证 URL 和密钥，再询问账号信息。密钥和密码输入时不会显示，也无需写入命令参数。请本人在自己的终端运行；不要把执行过程录屏或上传日志。账号仅创建一次。如果创建账号成功但所有者登记失败，请检查 SQL 初始化结果，不要重复创建账号。

## 3. 连接网页

把项目 URL 和 **publishable key** 填入站点中的 `js/drafts-config.js`；本地 Hexo 源文件为 `hexo/source/js/drafts-config.js`。这个 key 可以出现在浏览器中；安全性依赖 `schema.sql` 中的数据库与私有存储权限。**不要**填写 secret key。

上线后依次验证：未登录看不到草稿；唯一账号能够登录、创建、修改、自动保存、上传图片与附件、移到回收站并恢复；其他账号即使能够登录 Supabase，也不能读取或写入草稿。

## 内容与发布

草稿正文按块存储，支持段落、标题、代码、表格、链接、图片和附件，并自动保留旧版本。当前版本只管理私人草稿，不会把草稿自动写入公开 Hexo 文章。发布功能应在独立服务端实现，届时再把指定内容和媒体复制到公开站点。
