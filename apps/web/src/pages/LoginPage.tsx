import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { errorMessage } from "../lib/errors";

type Mode = "login" | "register";

/** Anmelden bzw. Konto anlegen (Umschalten per Knopf). */
export function LoginPage() {
  const { t } = useI18n();
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "register" && password !== repeat) {
      setError(t("authPasswordMismatch"));
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
        navigate("/");
      } else {
        await register(email.trim(), password, displayName.trim() || undefined);
        navigate("/sammlung");
      }
    } catch (err) {
      setError(`${t("authError")}: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm space-y-5 p-4">
      <h1 className="text-lg font-semibold">
        {mode === "login" ? t("authLoginTitle") : t("authRegisterTitle")}
      </h1>
      <p className="text-xs text-gray-400">{t("authHint")}</p>

      <form onSubmit={submit} className="space-y-3">
        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">{t("authEmail")}</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-base text-gray-100 focus:border-sky-500 focus:outline-none"
          />
        </label>

        {mode === "register" && (
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-gray-400">
              {t("authDisplayName")}
            </span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={60}
              className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-base text-gray-100 focus:border-sky-500 focus:outline-none"
            />
          </label>
        )}

        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wide text-gray-400">{t("authPassword")}</span>
          <input
            type="password"
            required
            minLength={mode === "register" ? 8 : undefined}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-base text-gray-100 focus:border-sky-500 focus:outline-none"
          />
        </label>

        {mode === "register" && (
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-gray-400">
              {t("authPasswordRepeat")}
            </span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-base text-gray-100 focus:border-sky-500 focus:outline-none"
            />
          </label>
        )}

        {error && (
          <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-sky-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-40"
        >
          {mode === "login" ? t("authSubmitLogin") : t("authSubmitRegister")}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "login" ? "register" : "login");
          setError(null);
        }}
        className="w-full text-center text-sm text-sky-400 underline"
      >
        {mode === "login" ? t("authToRegister") : t("authToLogin")}
      </button>

      <div className="border-t border-gray-800 pt-3">
        <Link to="/" className="text-sm text-gray-400 underline">
          {t("resultBack")}
        </Link>
      </div>
    </div>
  );
}
