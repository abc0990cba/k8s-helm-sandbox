module.exports = {
  port: 8080,
  pgUser: process.env.POSTGRES_USER || 'ps_user',
  pgHost: process.env.POSTGRES_HOST || 'localhost',
  pgDatabase: process.env.POSTGRES_DB || 'ps_db',
  pgPassword: process.env.POSTGRES_PASSWORD || 'SecurePassword',
  pgPort: process.env.POSTGRES_PORT || '5432',
  redisHost: process.env.REDIS_HOST || 'localhost',
  redisPort: process.env.REDIS_PORT || '6379',
};
