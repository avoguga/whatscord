import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default("0.0.0.0"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().optional(),

  JWT_SECRET: z.string().min(24, "JWT_SECRET must be at least 24 characters"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_DAYS: z.coerce.number().default(30),

  // The desktop app sends no Origin, so this only affects browser use.
  CORS_ORIGINS: z.string().default("*"),

  // Attachments. MinIO speaks S3; the API proxies downloads so the bucket
  // never has to be reachable from the internet.
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("whatscord"),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  MAX_UPLOAD_MB: z.coerce.number().default(100),
  // Where attachments live when S3 is not configured.
  UPLOAD_DIR: z.string().default("./uploads"),

  // Calls and screen sharing.
  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),

  // E-mail ("esqueci a senha"). Ver `lib/email.ts` para as duas formas de
  // entrar no Gmail. Tudo opcional: sem isto, o recurso diz que está desligado.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(465),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  GMAIL_REFRESH_TOKEN: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  /*
   * Para onde o link do e-mail aponta. É o SITE, e não a API: é lá que a tela
   * de criar a senha nova existe, e é o que qualquer pessoa consegue abrir,
   * tenha ou não o app instalado.
   */
  WEB_URL: z.string().default("https://whatscord.167.88.39.225.sslip.io")
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
  console.error("Configuration is incomplete:\n" + lines.join("\n"));
  process.exit(1);
}

export const env = parsed.data;

export const s3Configured = Boolean(
  env.S3_ENDPOINT && env.S3_ACCESS_KEY && env.S3_SECRET_KEY
);

export const callsEnabled = Boolean(
  env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET
);
