/**
 * Test-only defaults so modules that read the validated environment can load without a .env file.
 * Values are local placeholders. They are never used outside the test process.
 */
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=true";
process.env.AUTH_SECRET ??= "test-auth-secret-not-for-production-use";
process.env.NEXTAUTH_URL ??= "http://localhost:3000";

/**
 * Tests must never depend on, or use, real provider credentials that happen to be set in the shell. Every variable that
 * configures a delivery, social or webhook integration is removed before any test file loads. Tests that need an integration
 * set their own placeholder values (or inject fake providers) after this runs.
 */
for (const key of Object.keys(process.env)) {
  if (/^(EMAIL_|SMTP_|BREVO_|TELEGRAM_|MARKETING_|FACEBOOK_|SOCIAL_|AI_|GROQ_|OPENROUTER_|GEMINI_|STRIPE_)/.test(key)) delete process.env[key];
}
