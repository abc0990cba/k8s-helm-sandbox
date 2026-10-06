export const config = {
  port: process.env.PORT || 8030,
  libsqlUrl: process.env.LIBSQL_URL || 'http://localhost:8080',
  redisHost: process.env.REDIS_HOST || 'localhost',
  redisPort: process.env.REDIS_PORT || '6379',
};
