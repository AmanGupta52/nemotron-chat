import React, { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, KeyRound, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { useAuth } from "../auth/AuthContext.jsx";
import { ACCOUNT_API, apiRequest, AUTH_API } from "../auth/api.js";

function PageFrame({ children, eyebrow = "Nemotron Workbench" }) {
  return (
    <main className="account-page">
      <section className="account-card">
        <Link className="account-brand" to="/"><span className="brand-mark"><Sparkles size={16} /></span> Nemotron Workbench</Link>
        <p className="account-eyebrow">{eyebrow}</p>
        {children}
      </section>
    </main>
  );
}

function FormError({ children, success = false }) {
  return children ? <p className={`account-message ${success ? "success" : ""}`} role={success ? "status" : "alert"}>{children}</p> : null;
}

function FormField({ label, type = "text", value, onChange, required = true, autoComplete, ...props }) {
  return (
    <label className="account-field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} autoComplete={autoComplete} {...props} />
    </label>
  );
}

export function LoginPage() {
  const { user, setAuthenticatedUser, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!loading && user) return <Navigate to="/chat" replace />;

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await apiRequest(AUTH_API, { method: "POST", body: { action: "login", email, password } });
      setAuthenticatedUser(data.user);
      navigate("/chat", { replace: true });
    } catch (issue) {
      if (issue.data?.verificationRequired) {
        sessionStorage.setItem("verificationEmail", issue.data.email || email);
        sessionStorage.setItem("verificationSentAt", String(Date.now()));
        navigate("/verify-email", { state: { email: issue.data.email || email } });
      } else {
        setError(issue.message || "Could not sign in.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageFrame eyebrow="Welcome back">
      <h1>Sign in</h1>
      <p className="account-subtitle">Continue to your private AI workspace.</p>
      <form className="account-form" onSubmit={submit}>
        <FormField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <FormField label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <label className="account-check"><input type="checkbox" checked readOnly /> Remember me <small>All sessions expire after 30 days.</small></label>
        <FormError>{error}</FormError>
        <button className="btn primary account-submit" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <div className="account-links"><Link to="/forgot-password">Forgot password?</Link><span>New here? <Link to="/register">Create an account</Link></span></div>
      <Link className="account-back" to="/"><ArrowLeft size={15} /> Back to home</Link>
      {location.state?.message && <FormError success>{location.state.message}</FormError>}
    </PageFrame>
  );
}

export function RegisterPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", username: "", email: "", password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/chat" replace />;
  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await apiRequest(AUTH_API, { method: "POST", body: { action: "register", ...form } });
      sessionStorage.setItem("verificationEmail", form.email.trim().toLowerCase());
      sessionStorage.setItem("verificationSentAt", String(Date.now()));
      navigate("/verify-email", { state: { email: form.email.trim().toLowerCase() } });
    } catch (issue) {
      setError(issue.message || "Could not create your account.");
      if (issue.data?.email) {
        sessionStorage.setItem("verificationEmail", issue.data.email);
        navigate("/verify-email", { state: { email: issue.data.email } });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageFrame eyebrow="Create your account">
      <h1>Join the workbench</h1>
      <p className="account-subtitle">Your conversations stay private to your account.</p>
      <form className="account-form" onSubmit={submit}>
        <FormField label="Full name" value={form.name} onChange={set("name")} autoComplete="name" maxLength={100} />
        <FormField label="Username" value={form.username} onChange={set("username")} autoComplete="username" minLength={3} maxLength={32} />
        <FormField label="Email" type="email" value={form.email} onChange={set("email")} autoComplete="email" />
        <FormField label="Password (at least 12 characters)" type="password" value={form.password} onChange={set("password")} autoComplete="new-password" minLength={12} maxLength={128} />
        <FormField label="Confirm password" type="password" value={form.confirmPassword} onChange={set("confirmPassword")} autoComplete="new-password" minLength={12} maxLength={128} />
        <FormError>{error}</FormError>
        <button className="btn primary account-submit" type="submit" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
      </form>
      <p className="account-bottom">Already have an account? <Link to="/login">Sign in</Link></p>
    </PageFrame>
  );
}

export function VerifyEmailPage() {
  const { setAuthenticatedUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState(() => location.state?.email || sessionStorage.getItem("verificationEmail") || "");
  const [code, setCode] = useState("");
  const [remaining, setRemaining] = useState(() => {
    const sentAt = Number(sessionStorage.getItem("verificationSentAt"));
    return sentAt ? Math.max(0, 60 - Math.floor((Date.now() - sentAt) / 1000)) : 0;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!location.state?.email && !email) navigate("/login", { replace: true });
  }, [email, location.state, navigate]);
  useEffect(() => {
    if (!remaining) return undefined;
    const timer = window.setTimeout(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [remaining]);

  const verify = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await apiRequest(AUTH_API, { method: "POST", body: { action: "verify-email", email, code } });
      sessionStorage.removeItem("verificationEmail");
      sessionStorage.removeItem("verificationSentAt");
      setAuthenticatedUser(data.user);
      navigate("/chat", { replace: true });
    } catch (issue) {
      setError(issue.message || "Could not verify the code.");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await apiRequest(AUTH_API, { method: "POST", body: { action: "resend-verification", email } });
      setNotice(data.message);
      sessionStorage.setItem("verificationSentAt", String(Date.now()));
      setRemaining(60);
    } catch (issue) {
      setError(issue.message || "Could not resend the code.");
      if (issue.status === 429) {
        sessionStorage.setItem("verificationSentAt", String(Date.now()));
        setRemaining(60);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageFrame eyebrow="Email verification">
      <div className="account-icon"><ShieldCheck size={23} /></div>
      <h1>Check your inbox</h1>
      <p className="account-subtitle">Enter the 6-digit code sent to <strong>{email}</strong>. It expires in 10 minutes.</p>
      <form className="account-form" onSubmit={verify}>
        <FormField label="Verification code" type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))} maxLength={6} minLength={6} pattern="[0-9]{6}" />
        <FormError>{error}</FormError>
        <FormError success>{notice}</FormError>
        <button className="btn primary account-submit" type="submit" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Verify email"}</button>
      </form>
      <button className="account-resend" type="button" onClick={resend} disabled={busy || remaining > 0}>
        {remaining ? `Resend available in ${remaining}s` : "Resend code"}
      </button>
      <p className="account-bottom"><Link to="/login">Back to sign in</Link></p>
    </PageFrame>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await apiRequest(AUTH_API, { method: "POST", body: { action: "forgot-password", email } });
      setMessage(data.message);
      sessionStorage.setItem("resetEmail", email.trim().toLowerCase());
      navigate("/reset-password", { state: { email: email.trim().toLowerCase(), message: data.message } });
    } catch (issue) {
      setError(issue.message || "Could not request a reset code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageFrame eyebrow="Account recovery">
      <div className="account-icon"><KeyRound size={23} /></div>
      <h1>Forgot password?</h1>
      <p className="account-subtitle">If a verified account exists, we’ll send a time-limited reset code.</p>
      <form className="account-form" onSubmit={submit}>
        <FormField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <FormError>{error}</FormError>
        <FormError success>{message}</FormError>
        <button className="btn primary account-submit" type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset code"}</button>
      </form>
      <p className="account-bottom"><Link to="/login">Back to sign in</Link></p>
    </PageFrame>
  );
}

export function ResetPasswordPage() {
  const { setAuthenticatedUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email] = useState(() => location.state?.email || sessionStorage.getItem("resetEmail") || "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!email) return <Navigate to="/forgot-password" replace />;

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await apiRequest(AUTH_API, {
        method: "POST",
        body: { action: "reset-password", email, code, password, confirmPassword },
      });
      sessionStorage.removeItem("resetEmail");
      setAuthenticatedUser(data.user);
      navigate("/chat", { replace: true });
    } catch (issue) {
      setError(issue.message || "Could not reset the password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageFrame eyebrow="Secure your account">
      <div className="account-icon"><KeyRound size={23} /></div>
      <h1>Reset password</h1>
      <p className="account-subtitle">Enter the code sent to <strong>{email}</strong> and choose a new password.</p>
      <form className="account-form" onSubmit={submit}>
        <FormField label="6-digit reset code" value={code} onChange={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" maxLength={6} minLength={6} autoComplete="one-time-code" />
        <FormField label="New password (at least 12 characters)" type="password" value={password} onChange={setPassword} autoComplete="new-password" minLength={12} maxLength={128} />
        <FormField label="Confirm new password" type="password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" minLength={12} maxLength={128} />
        <FormError>{error}</FormError>
        <button className="btn primary account-submit" type="submit" disabled={busy}>{busy ? "Updating…" : "Reset password"}</button>
      </form>
      <p className="account-bottom"><Link to="/forgot-password">Request another code</Link></p>
    </PageFrame>
  );
}

export function ProfilePage() {
  const { user, refresh } = useAuth();
  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(ACCOUNT_API, { method: "PATCH", body: { name, username } });
      await refresh();
      setNotice("Profile updated.");
    } catch (issue) {
      setError(issue.message || "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  };
  const initials = (user.name || user.username).split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  return (
    <main className="account-page account-page-wide">
      <section className="account-card account-card-wide">
        <Link className="account-back" to="/chat"><ArrowLeft size={15} /> Back to chat</Link>
        <p className="account-eyebrow">Your account</p>
        <h1>Profile</h1>
        <div className="profile-header">
          <div className="profile-avatar" aria-label="Profile picture">{user.avatar ? <img src={user.avatar} alt="" /> : initials}</div>
          <div><strong>{user.name}</strong><span>@{user.username}</span></div>
        </div>
        <form className="account-form" onSubmit={save}>
          <FormField label="Full name" value={name} onChange={setName} autoComplete="name" maxLength={100} />
          <FormField label="Username" value={username} onChange={setUsername} autoComplete="username" minLength={3} maxLength={32} />
          <FormField label="Email" value={user.email} onChange={() => {}} readOnly />
          <div className="profile-verify"><ShieldCheck size={16} /> Email verified</div>
          <FormError>{error}</FormError>
          <FormError success>{notice}</FormError>
          <button className="btn primary account-submit" type="submit" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
        </form>
        <div className="profile-dates"><span>Account created {new Date(user.createdAt).toLocaleDateString()}</span><span>Last login {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "—"}</span></div>
      </section>
    </main>
  );
}

export function SettingsPage() {
  const { user, refresh, logout, setAuthenticatedUser } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useState(user.preferences?.theme || "system");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const saveTheme = async () => {
    setError("");
    setNotice("");
    try {
      await apiRequest(ACCOUNT_API, { method: "PATCH", body: { preferences: { theme } } });
      await refresh();
      window.dispatchEvent(new CustomEvent("workbench-theme", { detail: theme }));
      setNotice("Preference saved.");
    } catch (issue) {
      setError(issue.message || "Could not save preference.");
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const data = await apiRequest(AUTH_API, {
        method: "POST",
        body: { action: "change-password", currentPassword, newPassword, confirmPassword },
      });
      setAuthenticatedUser(data.user);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice("Password changed. Your other sessions have been signed out.");
    } catch (issue) {
      setError(issue.message || "Could not change your password.");
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await apiRequest(ACCOUNT_API, {
        method: "DELETE",
        body: { password: deletePassword, confirmation: deleteConfirmation },
      });
      setAuthenticatedUser(null);
      navigate("/register", { replace: true });
    } catch (issue) {
      setError(issue.message || "Could not delete the account.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (issue) {
      setError(issue.message || "Could not sign out.");
    }
  };

  return (
    <main className="account-page account-page-wide">
      <section className="account-card account-card-wide">
        <Link className="account-back" to="/chat"><ArrowLeft size={15} /> Back to chat</Link>
        <p className="account-eyebrow">Personalize your workspace</p>
        <h1>Settings</h1>
        <FormError>{error}</FormError>
        <FormError success>{notice}</FormError>

        <section className="settings-section">
          <h2><UserRound size={17} /> Account</h2>
          <p>{user.name} · @{user.username}<br /><span>{user.email} · Email verified</span></p>
          <Link className="btn ghost" to="/profile">Edit profile</Link>
        </section>

        <section className="settings-section">
          <h2><Sparkles size={17} /> Preferences</h2>
          <label className="account-field"><span>Appearance</span>
            <select value={theme} onChange={(event) => setTheme(event.target.value)}>
              <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
            </select>
          </label>
          <button className="btn primary" type="button" onClick={saveTheme}>Save preference</button>
        </section>

        <section className="settings-section">
          <h2><KeyRound size={17} /> Security</h2>
          <p>Session cookie: HttpOnly, SameSite, 30-day expiry. Password changes sign out other sessions.</p>
          <form className="account-form" onSubmit={changePassword}>
            <FormField label="Current password" type="password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
            <FormField label="New password (at least 12 characters)" type="password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" minLength={12} maxLength={128} />
            <FormField label="Confirm new password" type="password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" minLength={12} maxLength={128} />
            <button className="btn primary" type="submit" disabled={busy}>{busy ? "Updating…" : "Change password"}</button>
          </form>
        </section>

        <section className="settings-section danger-zone">
          <h2>Danger zone</h2>
          <p>Deleting your account permanently removes its conversations and sessions.</p>
          <button className="btn ghost danger-button" type="button" onClick={signOut}>Log out</button>
          <form className="account-form" onSubmit={deleteAccount}>
            <FormField label="Password to confirm deletion" type="password" value={deletePassword} onChange={setDeletePassword} autoComplete="current-password" />
            <FormField label='Type "DELETE" to confirm' value={deleteConfirmation} onChange={setDeleteConfirmation} autoComplete="off" />
            <button className="btn danger-button" type="submit" disabled={busy || deleteConfirmation !== "DELETE"}>{busy ? "Deleting…" : "Delete account and chats"}</button>
          </form>
        </section>
      </section>
    </main>
  );
}
