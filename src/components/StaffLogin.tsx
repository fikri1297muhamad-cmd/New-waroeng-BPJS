
import { useState } from 'react';
import {
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { StaffRole } from '../types';

type Props = {
  onLogin: (name: string, role: StaffRole) => void;
  onBack: () => void;
};

export default function StaffLogin({ onLogin, onBack }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [adminCode, setAdminCode] = useState('');
  const [adminName, setAdminName] = useState('');
  const [step, setStep] = useState<'login' | 'admin-code'>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError('Email dan password wajib diisi.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const credential = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

      const profileSnapshot = await getDoc(
        doc(db, 'staff_profiles', credential.user.uid)
      );

      if (!profileSnapshot.exists()) {
        throw new Error('Profil staf belum terdaftar.');
      }

      const profile = profileSnapshot.data();

      const role = String(profile.role ?? '')
        .trim()
        .toLowerCase();

      const isAdmin = role === 'admin' || role === 'admin 01';

      if (!isAdmin && role !== 'kasir') {
        throw new Error(
          `Jabatan akun tidak valid. Role terbaca: "${role}"`
        );
      }

      const name = profile.full_name || email.trim();

      if (role === 'kasir') {
        onLogin(name, 'kasir');
        return;
      }

      setAdminName(name);
      setStep('admin-code');
      setPassword('');
    } catch (err) {
      console.error(err);

      await signOut(auth);

      setError(
        err instanceof Error
          ? err.message
          : 'Login gagal. Periksa email dan password.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleAdminVerification = async () => {
    if (!adminCode.trim()) {
      setError('Kode akses Admin wajib diisi.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const user = auth.currentUser;

      if (!user) {
        throw new Error('Sesi login berakhir. Silakan login kembali.');
      }

      const token = await user.getIdToken();

      const response = await fetch('/api/admin-access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'verify',
          code: adminCode
        })
      });

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(
          result.error || 'Kode akses Admin tidak valid.'
        );
      }

      await user.getIdToken(true);

      setAdminCode('');
      onLogin(adminName, 'admin');
    } catch (err) {
      console.error(err);

      await signOut(auth);

      setAdminCode('');
      setStep('login');

      setError(
        err instanceof Error
          ? err.message
          : 'Verifikasi Admin gagal. Silakan login kembali.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    setLoading(true);

    try {
      await signOut(auth);
      setAdminCode('');
      setAdminName('');
      setStep('login');
      setError('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-green-50 via-white to-emerald-100 px-4 py-8">
      <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-green-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-20 h-72 w-72 rounded-full bg-emerald-200/40 blur-3xl" />

      <section className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-green-100 bg-white shadow-2xl shadow-green-900/10">

        <div className="bg-gradient-to-r from-green-800 to-green-600 px-6 py-8 text-center text-white">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl border border-white/30 bg-white/15 text-3xl font-black shadow-lg">
            WB
          </div>

          <h1 className="mt-4 text-2xl font-extrabold tracking-wide">
            WAROENG BPJS
          </h1>

          <p className="mt-1 text-sm font-medium text-green-100">
            Budget pas jajanan sehat
          </p>

          <div className="mx-auto mt-5 h-1 w-14 rounded-full bg-white/80" />

          <p className="mt-4 text-sm font-semibold tracking-widest text-white/90">
            PORTAL LOGIN STAF
          </p>
        </div>

        <div className="px-6 py-7 sm:px-8">
          <div className="mb-6 text-center">
            <h2 className="text-xl font-extrabold text-gray-800">
              {step === 'login' ? 'Selamat Datang' : 'Verifikasi Admin'}
            </h2>

            <p className="mt-2 text-sm leading-relaxed text-gray-500">
              {step === 'login'
                ? 'Silakan masuk menggunakan akun staf yang telah terdaftar.'
                : `Selamat datang, ${adminName}. Masukkan kode akses rahasia Admin.`}
            </p>
          </div>

          {step === 'login' ? (
            <>
              <label className="mb-2 block text-sm font-bold text-gray-700">
                Email
              </label>

              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Masukkan email"
                disabled={loading}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3.5 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-green-600 focus:bg-white focus:ring-4 focus:ring-green-100 disabled:opacity-60"
              />

              <label className="mb-2 mt-5 block text-sm font-bold text-gray-700">
                Password
              </label>

              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan password"
                  disabled={loading}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3.5 pr-14 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-green-600 focus:bg-white focus:ring-4 focus:ring-green-100 disabled:opacity-60"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={loading}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-sm font-semibold text-green-700 hover:bg-green-50 disabled:opacity-50"
                  aria-label={
                    showPassword
                      ? 'Sembunyikan password'
                      : 'Lihat password'
                  }
                >
                  {showPassword ? 'SEMBUNYI' : 'LIHAT'}
                </button>
              </div>

              <button
                type="button"
                onClick={handleLogin}
                disabled={loading}
                className="mt-7 flex w-full items-center justify-center rounded-xl bg-green-700 py-3.5 text-sm font-extrabold tracking-wider text-white shadow-lg shadow-green-700/20 transition hover:bg-green-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'MEMERIKSA AKUN...' : 'MASUK'}
              </button>
            </>
          ) : (
            <>
              <label className="mb-2 block text-sm font-bold text-gray-700">
                Kode Akses Admin
              </label>

              <input
                type="password"
                autoComplete="off"
                value={adminCode}
                onChange={(e) => setAdminCode(e.target.value)}
                placeholder="Masukkan kode rahasia"
                disabled={loading}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3.5 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-green-600 focus:bg-white focus:ring-4 focus:ring-green-100 disabled:opacity-60"
              />

              <button
                type="button"
                onClick={handleAdminVerification}
                disabled={loading}
                className="mt-6 w-full rounded-xl bg-green-700 py-3.5 text-sm font-extrabold tracking-wide text-white shadow-lg shadow-green-700/20 transition hover:bg-green-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'MEMVERIFIKASI...' : 'VERIFIKASI DAN MASUK'}
              </button>

              <button
                type="button"
                onClick={handleCancel}
                disabled={loading}
                className="mt-3 w-full rounded-xl border border-gray-200 bg-white py-3 text-sm font-bold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
              >
                BATAL
              </button>
            </>
          )}

          {error && (
            <div
              role="alert"
              className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-relaxed text-red-700"
            >
              {error}
            </div>
          )}

          <div className="mt-6 rounded-xl bg-green-50 px-4 py-3 text-center">
            <p className="text-xs font-semibold text-green-800">
              Akses khusus Admin dan Kasir
            </p>
            <p className="mt-1 text-[11px] text-green-700">
              Gunakan akun staf yang telah terdaftar.
            </p>
          </div>

          <button
            type="button"
            onClick={onBack}
            disabled={loading}
            className="mt-5 w-full rounded-xl border border-green-200 bg-white py-3 text-sm font-bold text-green-800 transition hover:border-green-400 hover:bg-green-50 disabled:opacity-50"
          >
            ← Kembali ke Halaman Pelanggan
          </button>
        </div>

        <div className="border-t border-gray-100 px-6 py-4 text-center">
          <p className="text-[11px] font-medium text-gray-400">
            WAROENG BPJS • Portal Staf
          </p>
        </div>
      </section>
    </main>
  );
}
