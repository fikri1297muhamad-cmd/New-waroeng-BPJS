
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
};

export default function StaffLogin({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

      

const profileSnapshot = await getDoc(
  doc(db, 'staff_profiles', credential.user.uid)
);

if (!profileSnapshot.exists()) {
  throw new Error('Profil staf belum terdaftar.');
}

const profile = profileSnapshot.data();

console.log('DATA PROFIL LOGIN:', profile);
console.log('ROLE TERBACA:', profile.role);

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
    <main className="flex min-h-screen items-center justify-center bg-amber-50 p-4">
      <section className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg">
        <h1 className="text-2xl font-extrabold text-green-800">
          WAROENG BPJS
        </h1>

        <p className="mt-2 text-gray-500">
          Login khusus Admin dan Kasir
        </p>

        {step === 'login' ? (
          <>
            <label className="mb-2 mt-6 block text-sm font-semibold">
              Email
            </label>

            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Masukkan email"
              className="w-full rounded-xl border p-3"
            />

            <label className="mb-2 mt-4 block text-sm font-semibold">
              Password
            </label>

            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Masukkan password"
              className="w-full rounded-xl border p-3"
            />

            <button
              onClick={handleLogin}
              disabled={loading}
              className="mt-5 w-full rounded-xl bg-green-800 py-3 font-bold text-white disabled:opacity-50"
            >
              {loading ? 'Memeriksa akun...' : 'Masuk'}
            </button>
          </>
        ) : (
          <>
            <p className="mt-6 font-semibold text-green-900">
              Verifikasi Admin
            </p>

            <p className="mt-2 text-sm text-gray-600">
              Selamat datang, {adminName}. Masukkan kode akses rahasia Admin.
            </p>

            <label className="mb-2 mt-5 block text-sm font-semibold">
              Kode Akses Admin
            </label>

            <input
              type="password"
              autoComplete="off"
              value={adminCode}
              onChange={(e) => setAdminCode(e.target.value)}
              placeholder="Masukkan kode rahasia"
              className="w-full rounded-xl border p-3"
            />

            <button
              onClick={handleAdminVerification}
              disabled={loading}
              className="mt-5 w-full rounded-xl bg-green-800 py-3 font-bold text-white disabled:opacity-50"
            >
              {loading ? 'Memverifikasi...' : 'Verifikasi dan Masuk'}
            </button>

            <button
              onClick={handleCancel}
              disabled={loading}
              className="mt-3 w-full rounded-xl border border-gray-300 py-3 font-semibold text-gray-700 disabled:opacity-50"
            >
              Batal
            </button>
          </>
        )}

        {error && (
          <p className="mt-3 rounded-lg bg-red-100 p-3 text-sm text-red-800">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
