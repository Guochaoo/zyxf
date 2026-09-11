// Env bootstrap — imported first so src modules read the right values.
//
// IMPROVE-02（就地豁免）：本文件与前后端测试里出现的 test-*/secret 字面量**全部是虚构的
// 测试凭据**，不是真实密钥，只用于环境引导与单测断言（真实凭据只在 .env / 云端 RAM）。
// 静态扫描常把这些字面量报成「硬编码凭据」——属误报；改名并不能消除标记，反而会破坏
// 既有断言，故保持原样并在此显式声明。
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-0123456789-0123456789';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'admin123';
process.env.OSS_REGION = 'oss-cn-test';
process.env.OSS_BUCKET = 'zyxf-test-bucket';
process.env.OSS_ACCESS_KEY_ID = 'test-access-key-id';
process.env.OSS_ACCESS_KEY_SECRET = 'test-access-key-secret';
process.env.OSS_ENDPOINT = 'https://zyxf.test';
process.env.OSS_KEY_PREFIX = 'zyxf-test/';
