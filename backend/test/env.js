// Env bootstrap — imported first so src modules read the right values.
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
