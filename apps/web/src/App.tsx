import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { I18nProvider, LANGUAGES, useI18n } from "./lib/i18n";
import { ScanPage } from "./pages/ScanPage";
import { ResultPage } from "./pages/ResultPage";
import { HistoryPage } from "./pages/HistoryPage";
import { CollectionPage } from "./pages/CollectionPage";
import { CardDetailPage } from "./pages/CardDetailPage";
import { LoginPage } from "./pages/LoginPage";
import { OfflineBanner } from "./components/OfflineBanner";
import { InstallBanner } from "./components/InstallBanner";

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <Layout />
      </AuthProvider>
    </I18nProvider>
  );
}

function Layout() {
  const { t, lang, setLang } = useI18n();
  const { user } = useAuth();

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-2 py-1.5 ${isActive ? "bg-gray-800 text-white" : "text-gray-400"}`;

  return (
    <div className="min-h-dvh bg-gray-950 text-gray-100">
      <header className="app-header sticky top-0 z-20 flex items-center gap-2 border-b border-gray-800 bg-gray-950/95 px-3 backdrop-blur">
        <NavLink to="/" className="flex-none text-sm font-semibold tracking-tight">
          {t("appTitle")}
        </NavLink>

        <nav className="ml-auto flex min-w-0 items-center gap-0.5 text-sm">
          <NavLink to="/sammlung" className={navClass}>
            {t("navCollection")}
          </NavLink>
          <NavLink to="/verlauf" className={navClass}>
            {t("navHistory")}
          </NavLink>

          {user ? (
            <NavLink
              to="/sammlung"
              title={`${t("authSignedInAs")} ${user.email}`}
              className="ml-1 max-w-20 truncate rounded-lg border border-gray-700 px-1.5 py-1.5 text-xs text-gray-300"
            >
              {user.displayName ?? user.email}
            </NavLink>
          ) : (
            <NavLink
              to="/anmelden"
              className="ml-1 rounded-lg border border-sky-600/60 px-2 py-1.5 text-xs text-sky-300"
            >
              {t("navLogin")}
            </NavLink>
          )}

          <div className="ml-1 flex overflow-hidden rounded-lg border border-gray-700">
            {LANGUAGES.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                aria-label={`${t("language")}: ${l}`}
                className={`px-1.5 py-1.5 text-xs uppercase ${
                  lang === l ? "bg-gray-700 text-white" : "text-gray-400"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <OfflineBanner />
      <InstallBanner />

      <main>
        <Routes>
          <Route path="/" element={<ScanPage />} />
          <Route path="/scan/:id" element={<ResultPage />} />
          <Route path="/verlauf" element={<HistoryPage />} />
          <Route path="/sammlung" element={<CollectionPage />} />
          <Route path="/karte/:id" element={<CardDetailPage />} />
          <Route path="/anmelden" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
