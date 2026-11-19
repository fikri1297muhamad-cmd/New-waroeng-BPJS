
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import StaffLogin from './components/StaffLogin';
import AdminView from './components/AdminView';
import KasirView from './components/KasirView';
import type { StaffRole, MenuItem, PromoBanner } from './types';
import { useEffect, useRef, useState } from 'react';
import {
  listenToMenus,
  listenToBanners,
  createOrder
} from './services/firestore';
import Cart from './components/Cart';
import CustomerForm from './components/CustomerForm';
import OrderConfirmation from './components/OrderConfirmation';
import * as QRCode from 'qrcode';

type CartItem = {
  menu: MenuItem;
  quantity: number;
};

const categories = [
  { id: 'semua', label: 'Semua' },
  { id: 'makanan', label: 'Makanan' },
  { id: 'minuman', label: 'Minuman' },
  { id: 'cemilan', label: 'Cemilan' }
];

const rupiah = (price: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(price);

export default function App() {
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [banners, setBanners] = useState<PromoBanner[]>([]);
  const [pressedMenuId, setPressedMenuId] = useState<string | null>(null);

  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const savedCart = localStorage.getItem('waroeng_bpjs_cart');

      return savedCart
        ? JSON.parse(savedCart) as CartItem[]
        : [];
    } catch {
      return [];
    }
  });

  const [category, setCategory] = useState('semua');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [orderError, setOrderError] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [tableNumber, setTableNumber] = useState(0);

  const [tableQrToken, setTableQrToken] = useState('');
  const [tableQrVerified, setTableQrVerified] = useState(false);
  const [tableQrChecking, setTableQrChecking] = useState(true);
  const [tableQrMessage, setTableQrMessage] = useState(
    'Memeriksa QR meja...'
  );

  const qrVerificationStarted = useRef(false);

  const [showConfirmation, setShowConfirmation] = useState(false);
  const [sending, setSending] = useState(false);

  const [successOrder, setSuccessOrder] = useState<{
    orderCode: string;
    name: string;
    table: number;
    items: {
      menu_id: string;
      item_name: string;
      item_price: number;
      quantity: number;
      subtotal: number;
    }[];
    total: number;
  } | null>(null);

  const [orderQrDataUrl, setOrderQrDataUrl] = useState('');

  const [staffRole, setStaffRole] = useState<StaffRole | null>(null);
  const [staffName, setStaffName] = useState('');
  const isLoginPath = window.location.pathname === '/login';

  const [authChecking, setAuthChecking] = useState(true);

  useEffect(() => {
    localStorage.setItem(
      'waroeng_bpjs_cart',
      JSON.stringify(cart)
    );
  }, [cart]);

  useEffect(() => {
    let cancelled = false;

    if (!successOrder?.orderCode) {
      setOrderQrDataUrl('');
      return;
    }

    QRCode.toDataURL(successOrder.orderCode, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'M'
    })
      .then((url) => {
        if (!cancelled) {
          setOrderQrDataUrl(url);
        }
      })
      .catch((err) => {
        console.error('Gagal membuat QR pesanan:', err);

        if (!cancelled) {
          setOrderQrDataUrl('');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [successOrder?.orderCode]);

  useEffect(() => {
    if (qrVerificationStarted.current) return;
    qrVerificationStarted.current = true;

    const verifyTableQr = async () => {
      const storageKey = 'waroeng_bpjs_verified_table_qr';
      const currentUrl = new URL(window.location.href);

      const tableParam = currentUrl.searchParams.get('table');
      const tokenParam = currentUrl.searchParams.get('token');

      let candidateTable: string | null = tableParam;
      let candidateToken: string | null = tokenParam;

      if (tableParam !== null || tokenParam !== null) {
        currentUrl.searchParams.delete('table');
        currentUrl.searchParams.delete('token');

        const remainingUrl =
          currentUrl.pathname +
          currentUrl.search +
          currentUrl.hash;

        window.history.replaceState({}, '', remainingUrl);

        if (!tableParam || !tokenParam) {
          sessionStorage.removeItem(storageKey);
        }
      } else {
        const savedQr = sessionStorage.getItem(storageKey);

        if (savedQr) {
          try {
            const parsed = JSON.parse(savedQr);

            if (
              parsed &&
              parsed.table_number !== undefined &&
              typeof parsed.token === 'string'
            ) {
              candidateTable = String(parsed.table_number);
              candidateToken = parsed.token;
            } else {
              sessionStorage.removeItem(storageKey);
            }
          } catch {
            sessionStorage.removeItem(storageKey);
          }
        }
      }

      if (!candidateTable || !candidateToken) {
        setTableNumber(0);
        setTableQrToken('');
        setTableQrVerified(false);
        setTableQrChecking(false);
        setTableQrMessage(
          'Silakan pindai QR meja untuk mulai memesan.'
        );
        return;
      }

      if (
        !/^(0?[1-9]|[1-4][0-9]|50)$/.test(candidateTable) ||
        !/^[A-Za-z0-9_-]{43}$/.test(candidateToken)
      ) {
        sessionStorage.removeItem(storageKey);
        setTableNumber(0);
        setTableQrToken('');
        setTableQrVerified(false);
        setTableQrChecking(false);
        setTableQrMessage(
          'QR meja tidak valid. Silakan pindai ulang QR meja.'
        );
        return;
      }

      const requestedTable = Number(candidateTable);

      setTableNumber(0);
      setTableQrToken('');
      setTableQrVerified(false);
      setTableQrChecking(true);
      setTableQrMessage('Memverifikasi QR meja...');

      let serverRejected = false;

      try {
        const response = await fetch('/api/verify-table-qr', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          cache: 'no-store',
          body: JSON.stringify({
            table_number: requestedTable,
            token: candidateToken
          })
        });

        const result = await response.json();

        if (
          !response.ok ||
          result?.success !== true ||
          result?.verified !== true ||
          Number(result?.table_number) !== requestedTable
        ) {
          serverRejected = true;
          throw new Error('QR meja tidak dapat diverifikasi.');
        }

        sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            table_number: requestedTable,
            token: candidateToken
          })
        );

        setTableNumber(requestedTable);
        setTableQrToken(candidateToken);
        setTableQrVerified(true);
        setTableQrMessage(
          `Meja ${String(requestedTable).padStart(2, '0')} berhasil diverifikasi.`
        );
      } catch (err) {
        console.error('Verifikasi QR meja gagal:', err);

        if (serverRejected) {
          sessionStorage.removeItem(storageKey);
        }

        setTableNumber(0);
        setTableQrToken('');
        setTableQrVerified(false);
        setTableQrMessage(
          'QR meja tidak valid atau gagal diverifikasi. Silakan pindai ulang.'
        );
      } finally {
        setTableQrChecking(false);
      }
    };

    void verifyTableQr();
  }, []);

  const handleStaffLogin = (name: string, role: StaffRole) => {
    setStaffName(name);
    setStaffRole(role);
  };

  const handleStaffLogout = async () => {
    const user = auth.currentUser;
    if (user) {
      try {
        await deleteDoc(doc(db, 'cashier_presence', user.uid));
      } catch (error) {
        console.error('Gagal menghapus status kehadiran kasir:', error);
      }
    }
    await signOut(auth);
    setStaffRole(null);
    setStaffName('');
  };

  useEffect(() => {
    let active = true;

    if (!isLoginPath) {
      setAuthChecking(true);
    } else {
      setAuthChecking(false);
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return;

      if (!user) {
        setStaffRole(null);
        setStaffName('');
        setAuthChecking(false);
        return;
      }

      try {
        const profileSnapshot = await getDoc(
          doc(db, 'staff_profiles', user.uid)
        );

        if (!active) return;

        if (!profileSnapshot.exists()) {
          throw new Error('Profil staf tidak ditemukan.');
        }

        const profile = profileSnapshot.data();

        const role = String(profile.role ?? '')
          .trim()
          .toLowerCase();

        const name = String(
          profile.full_name || user.email || 'Staf'
        );

        if (role === 'kasir') {
          setStaffName(name);
          setStaffRole('kasir');
          return;
        }

        if (role === 'admin' || role === 'admin 01') {
          const tokenResult = await user.getIdTokenResult();

          if (!active) return;

          const adminAccess =
            tokenResult.claims.adminAccess === true;

          const adminAccessUntil = Number(
            tokenResult.claims.adminAccessUntil ?? 0
          );

          const currentTime = Math.floor(Date.now() / 1000);

          if (
            !adminAccess ||
            adminAccessUntil <= currentTime
          ) {
            if (!isLoginPath) {
              await signOut(auth);
            }

            if (active) {
              setStaffRole(null);
              setStaffName('');
            }

            return;
          }

          setStaffName(name);
          setStaffRole('admin');
          return;
        }

        throw new Error('Role staf tidak dikenali.');
      } catch (err) {
        console.error('Pemulihan sesi staf gagal:', err);

        try {
          await signOut(auth);
        } catch (signOutError) {
          console.error(
            'Gagal mengakhiri sesi staf:',
            signOutError
          );
        }

        if (active) {
          setStaffRole(null);
          setStaffName('');
        }
      } finally {
        if (active) {
          setAuthChecking(false);
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };

  }, [isLoginPath]);

  // Kehadiran kasir: heartbeat setiap 15 detik.
  useEffect(() => {
    if (staffRole !== 'kasir') return;

    let heartbeat: number | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (heartbeat !== undefined) {
        window.clearInterval(heartbeat);
        heartbeat = undefined;
      }

      if (!user) return;

      const presenceRef = doc(db, 'cashier_presence', user.uid);
      let hasReportedPresenceError = false;

      const publishPresence = () => {
        void setDoc(presenceRef, {
          full_name: staffName,
          lastSeen: serverTimestamp()
        }).catch((error) => {
          console.error('Gagal memperbarui kehadiran kasir:', error);
          if (!hasReportedPresenceError) {
            hasReportedPresenceError = true;
            const detail = error instanceof Error ? error.message : String(error);
            window.alert('Gagal menyimpan kehadiran kasir: ' + detail);
          }
        });
      };

      publishPresence();
      heartbeat = window.setInterval(publishPresence, 15000);
    });

    return () => {
      unsubscribeAuth();
      if (heartbeat !== undefined) {
        window.clearInterval(heartbeat);
      }
    };
  }, [staffRole, staffName]);


  useEffect(() => {
    const unsubscribe = listenToMenus(
      (data) => {
        setMenus(data);
        setLoading(false);
        setError('');
      },
      (err) => {
        console.error(err);
        setError('Gagal menghubungkan menu ke Firebase.');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = listenToBanners(
      (data) => {
        setBanners(data);
      },
      (err) => {
        console.error('Gagal memuat banner:', err);
        setBanners([]);
      }
    );

    return () => unsubscribe();
  }, []);

  const activeBanners = banners.filter(
    (banner) =>
      banner.is_active &&
      (banner.title.trim() !== '' ||
        banner.description.trim() !== '' ||
        banner.image_url.trim() !== '')
  );

  const addToCart = (menu: MenuItem) => {
    setCart((current) => {
      const found = current.find(
        (item) => item.menu.id === menu.id
      );

      if (found) {
        return current.map((item) =>
          item.menu.id === menu.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }

      return [...current, { menu, quantity: 1 }];
    });
  };

  const removeFromCart = (menuId: string) => {
    setCart((current) =>
      current
        .map((item) =>
          item.menu.id === menuId
            ? { ...item, quantity: item.quantity - 1 }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const total = cart.reduce(
    (sum, item) => sum + item.menu.price * item.quantity,
    0
  );

  const orderItems = cart.map((item) => ({
    menu_id: item.menu.id,
    item_name: item.menu.name,
    item_price: Number(item.menu.price),
    quantity: item.quantity,
    subtotal: Number(item.menu.price) * item.quantity
  }));

  const filteredMenus = menus.filter((item) =>
    category === 'semua' || item.category === category
  );

  const startConfirmation = (name: string, table: number) => {
    setOrderError('');

    if (!tableQrVerified || !tableQrToken) {
      setOrderError(
        'QR meja belum terverifikasi. Silakan pindai ulang QR meja.'
      );
      return;
    }

    if (table !== tableNumber) {
      setOrderError(
        'Nomor meja tidak sesuai dengan QR yang dipindai.'
      );
      return;
    }

    if (cart.length === 0) {
      setOrderError('Silakan pilih menu terlebih dahulu.');
      return;
    }

    setCustomerName(name);
    setTableNumber(table);
    setShowConfirmation(true);
  };

  const submitOrder = async () => {
    if (sending) return;

    if (!tableQrVerified || !tableQrToken) {
      setOrderError(
        'QR meja belum terverifikasi. Silakan pindai ulang QR meja.'
      );
      setShowConfirmation(false);
      return;
    }

    setSending(true);
    setOrderError('');

    try {
      const result = await createOrder({
        customer_name: customerName,
        table_number: tableNumber,
        table_qr_token: tableQrToken,
        items: orderItems,
        total_amount: total
      });

      setSuccessOrder({
        orderCode: result.order_code,
        name: customerName,
        table: tableNumber,
        items: result.items,
        total: result.totalAmount
      });

      setCart([]);
      setShowConfirmation(false);
    } catch (err) {
      console.error(err);
      setOrderError(
        'Pesanan belum berhasil disimpan. Silakan coba kembali.'
      );
      setShowConfirmation(false);
    } finally {
      setSending(false);
    }
  };

  if (authChecking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-green-50 p-4">
        <div className="rounded-xl bg-white px-6 py-5 text-center shadow">
          <p className="font-semibold text-green-800">
            Memeriksa sesi...
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Mohon tunggu sebentar.
          </p>
        </div>
      </main>
    );
  }

  if (staffRole) {
    return (
      <div>
        {staffRole === 'admin' && (
          <div className="flex items-center justify-between bg-green-900 p-4 text-white">
            <div>
              <p className="font-bold">{staffName}</p>
              <p className="text-sm">Administrator</p>
            </div>

            <button
              onClick={handleStaffLogout}
              className="rounded-lg bg-white px-4 py-2 font-bold text-green-900"
            >
              Keluar
            </button>
          </div>
        )}

        {staffRole === 'admin' ? <AdminView /> : <KasirView onLogout={handleStaffLogout} />}
      </div>
    );
  }

  if (isLoginPath) {
    return (
      <StaffLogin
        onLogin={handleStaffLogin}
        onBack={() => window.location.assign('/')}
      />
    );
  }

  if (successOrder) {
    return (
      <main className="receipt-screen flex h-[100dvh] min-h-0 items-center justify-center overflow-hidden bg-green-50 p-2 sm:p-4">
        <style>{`
          @page {
            margin: 12mm;
          }

          @media print {
            body {
              background: white !important;
            }

            .receipt-screen {
              display: block !important;
              height: auto !important;
              min-height: 0 !important;
              overflow: visible !important;
              padding: 0 !important;
              background: white !important;
            }

            .receipt-card {
              display: block !important;
              width: 100% !important;
              max-width: none !important;
              height: auto !important;
              min-height: 0 !important;
              overflow: visible !important;
              margin: 0 !important;
              padding: 0 !important;
              border-radius: 0 !important;
              box-shadow: none !important;
            }

            .receipt-details {
              flex: none !important;
              overflow: visible !important;
            }

            .receipt-actions {
              display: none !important;
            }

            .receipt-item {
              break-inside: avoid;
            }
          }
        `}</style>

        <div className="receipt-card mx-auto flex h-full min-h-0 w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white p-3 shadow-lg sm:p-5">
          {/* IDENTITAS WAROENG */}
          <div className="shrink-0 text-center">
            <div className="flex items-center justify-center gap-2">
              <img
                src="/logo.png"
                alt="Logo Waroeng BPJS"
                className="h-12 w-12 object-contain sm:h-14 sm:w-14"
              />

              <div className="text-left">
                <h1 className="text-lg font-extrabold leading-tight text-green-800 sm:text-2xl">
                  WAROENG BPJS
                </h1>

                <p className="text-[10px] text-gray-600 sm:text-xs">
                  Budget pas jajanan sehat
                </p>
              </div>
            </div>

            <p className="mt-1 text-[9px] leading-relaxed text-gray-600 sm:text-xs">
              Jl. Kandang Sapi 001/002 No. 01 Desa Tanjungsari,
              Kecamatan Sukaluyu, Kabupaten Cianjur
            </p>
          </div>

          <hr className="my-2 shrink-0 border-gray-200" />

          {/* NAMA PEMESAN DAN NOMOR MEJA */}
          <div className="shrink-0">
            <div className="grid grid-cols-2 gap-3 text-xs sm:text-sm">
              <div>
                <p className="text-[9px] text-gray-500 sm:text-[10px]">
                  NO. MEJA
                </p>

                <p className="font-bold text-gray-800">
                  Meja {String(successOrder.table).padStart(2, '0')}
                </p>
              </div>

              <div className="min-w-0">
                <p className="text-[9px] text-gray-500 sm:text-[10px]">
                  NAMA PEMESAN
                </p>

                <p className="break-words font-bold text-gray-800">
                  {successOrder.name}
                </p>
              </div>
            </div>

            <p className="mt-1 text-[9px] leading-relaxed text-green-800 sm:text-[10px]">
              Silakan screenshot pesanan Anda dan tunjukkan kepada staf kasir kami.
            </p>
          </div>

          <hr className="my-2 shrink-0 border-gray-200" />

          {/* NOMOR DAN QR PESANAN */}
          <div className="flex shrink-0 items-center justify-center gap-3">
            <div className="min-w-0 flex-1 text-center">
              <p className="text-[10px] font-bold text-gray-700 sm:text-xs">
                NOMOR PESANAN
              </p>

              <p className="mt-1 break-all text-base font-extrabold text-green-800 sm:text-xl">
                {successOrder.orderCode}
              </p>

              <p className="mt-1 text-[9px] text-gray-500 sm:text-[10px]">
                QR Code Nomor Pesanan
              </p>
            </div>

            <div className="flex h-24 w-24 shrink-0 items-center justify-center sm:h-28 sm:w-28">
              {orderQrDataUrl ? (
                <img
                  src={orderQrDataUrl}
                  alt="QR Pesanan"
                  className="h-full w-full object-contain"
                />
              ) : (
                <p className="text-center text-[9px] text-gray-500">
                  Menyiapkan QR pesanan...
                </p>
              )}
            </div>
          </div>

          <hr className="my-2 shrink-0 border-gray-200" />

          {/* HANYA BAGIAN INI YANG DAPAT DIGULIR */}
          <div className="receipt-details min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <h2 className="mb-1 text-xs font-extrabold text-gray-800 sm:text-sm">
              RINCIAN PESANAN
            </h2>

            {successOrder.items.map((item, index) => (
              <div
                key={`${item.menu_id}-${index}`}
                className="receipt-item grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-gray-100 py-2 text-xs sm:text-sm"
              >
                <div className="min-w-0">
                  <p className="break-words font-semibold text-gray-800">
                    {index + 1}. {item.item_name}
                  </p>

                  <p className="mt-0.5 text-[10px] text-gray-500 sm:text-xs">
                    {item.quantity} × {rupiah(item.item_price)}
                  </p>
                </div>

                <p className="whitespace-nowrap text-right font-bold text-gray-800">
                  {rupiah(item.subtotal)}
                </p>
              </div>
            ))}
          </div>

          {/* TOTAL DAN INFORMASI PEMBAYARAN TETAP TERLIHAT */}
          <div className="mt-2 shrink-0">
            <div className="flex items-center justify-between gap-2 rounded-lg bg-green-50 px-3 py-2">
              <span className="text-sm font-extrabold text-gray-800">
                TOTAL
              </span>

              <span className="text-base font-extrabold text-green-800">
                {rupiah(successOrder.total)}
              </span>
            </div>

            <div className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-[10px] leading-relaxed text-gray-800 sm:text-xs">
              <p className="font-extrabold text-green-800">
                INFORMASI PEMBAYARAN
              </p>

              <p className="mt-1">
                Silakan lakukan pembayaran di kasir dengan menunjukkan
                bukti pesanan ini atau QR kode pesanan kepada staf kasir.
              </p>

              <p className="mt-1 font-semibold text-amber-800">
                Status pembayaran: BELUM LUNAS
              </p>

              <p className="mt-1 text-center text-sm font-extrabold text-green-800">
                TERIMA KASIH
              </p>
            </div>

            {/* TOMBOL SELALU TERLIHAT */}
            <div className="receipt-actions mt-2 grid shrink-0 grid-cols-2 gap-2">
              <button
                onClick={() => window.print()}
                className="w-full rounded-lg bg-orange-500 px-2 py-2.5 text-xs font-bold text-white hover:bg-orange-600 sm:text-sm"
              >
                Cetak / Simpan PDF
              </button>

              <button
                onClick={() => setSuccessOrder(null)}
                className="w-full rounded-lg bg-green-800 px-2 py-2.5 text-xs font-bold text-white sm:text-sm"
              >
                ← Kembali ke Halaman Utama
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-green-50 pb-[calc(230px+env(safe-area-inset-bottom))]">
      {/* HEADER PELANGGAN - DIPERTAHANKAN */}
      <header className="bg-white px-4 py-4 shadow-sm sm:px-6 sm:py-5">
        <div className="mx-auto max-w-5xl">
          <div className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[100px_minmax(0,1fr)_auto] sm:gap-4">
            <img
              src="/logo.png"
              alt="Logo Waroeng BPJS"
              className="h-16 w-16 object-contain sm:h-24 sm:w-24"
            />

            <div className="min-w-0 text-center">
              <h1 className="text-lg font-extrabold leading-tight tracking-wide text-green-900 sm:text-4xl">
                WAROENG BPJS
              </h1>

              <p className="mt-1 text-[10px] font-semibold text-green-700 sm:text-base">
                Budget pas jajanan sehat
              </p>
            </div>

          </div>

          <div className="mt-3 border-t border-green-100 pt-3 text-center text-[11px] leading-relaxed text-gray-600 sm:text-sm">
            Jl. Kandang Sapi 001/002 No. 01 Desa Tanjungsari
            <br />
            Kecamatan Sukaluyu, Kabupaten Cianjur
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-4 py-4">
        {/* BANNER PROMOSI DINAMIS */}
        {activeBanners.length > 0 && (
          <div className="mb-5 space-y-4">
            {activeBanners.map((banner) => (
              <article
                key={banner.id}
                className="overflow-hidden rounded-2xl border border-green-100 bg-white shadow-sm"
              >
                {banner.image_url && (
                  <img
                    src={banner.image_url}
                    alt={banner.title || 'Banner promosi Waroeng BPJS'}
                    className="max-h-64 w-full object-cover sm:max-h-80"
                  />
                )}

                {(banner.title || banner.description) && (
                  <div className="p-4 sm:p-5">
                    {banner.title && (
                      <h2 className="text-lg font-extrabold text-green-900 sm:text-2xl">
                        {banner.title}
                      </h2>
                    )}

                    {banner.description && (
                      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-600 sm:text-base">
                        {banner.description}
                      </p>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        {/* STATUS QR MEJA - VERSI RINGKAS */}
        <div className="mb-5 border-b border-green-100 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-extrabold text-gray-800">
              STATUS QR MEJA
            </h2>

            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                tableQrVerified
                  ? 'bg-green-100 text-green-800'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {tableQrVerified ? 'TERVERIFIKASI' : 'BELUM TERVERIFIKASI'}
            </span>
          </div>

          <p
            className={`mt-1.5 text-xs leading-relaxed ${
              tableQrVerified
                ? 'font-semibold text-green-700'
                : 'text-gray-600'
            }`}
          >
            {tableQrMessage}
          </p>

          {tableQrChecking && (
            <p className="mt-1 text-[10px] text-gray-500">
              Mohon tunggu, sistem sedang memeriksa QR.
            </p>
          )}

          {tableQrVerified && (
            <p className="mt-1 text-sm font-extrabold text-green-900">
              Meja {String(tableNumber).padStart(2, '0')}
            </p>
          )}
        </div>

        {/* DATA PEMESAN */}
        <div className="mb-5">
          <CustomerForm
            tableNumber={tableNumber || null}
            tableQrVerified={tableQrVerified}
            name={customerName}
            onNameChange={setCustomerName}
          />
        </div>

        {/* PILIHAN MENU */}
        <div className="mb-4">
          <h2 className="text-xl font-extrabold text-green-900 sm:text-2xl">
            Pilihan Menu
          </h2>

          <p className="mt-1 text-xs text-gray-500 sm:text-sm">
            Pilih makanan, minuman, dan cemilan favoritmu.
          </p>
        </div>

        <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
          {categories.map((item) => (
            <button
              key={item.id}
              onClick={() => setCategory(item.id)}
              className={`shrink-0 rounded-full px-5 py-2 text-sm font-semibold transition ${
                category === item.id
                  ? 'bg-green-800 text-white shadow-sm'
                  : 'border border-green-100 bg-white text-gray-700 hover:bg-green-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {loading && (
          <p className="py-10 text-center text-green-800">
            Menghubungkan menu...
          </p>
        )}

        {error && (
          <div className="rounded-xl bg-red-100 p-4 text-red-800">
            {error}
          </div>
        )}

        {!loading && !error && filteredMenus.length === 0 && (
          <div className="rounded-xl border border-green-100 bg-white p-8 text-center text-gray-600">
            Menu belum tersedia.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 sm:gap-5">
          {filteredMenus.map((item) => (
            <article
              key={item.id}
              className="overflow-hidden rounded-2xl border border-green-50 bg-white shadow-sm transition hover:shadow-md"
            >
              <div
                className="relative aspect-[4/3] w-full bg-green-50"
                onTouchStart={() => setPressedMenuId(item.id)}
                onTouchEnd={() => setPressedMenuId(null)}
                onTouchCancel={() => setPressedMenuId(null)}
              >
                {item.image_url ? (
                  <img
                    src={item.image_url}
                    alt={item.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-5xl">
                    🍽️
                  </div>
                )}

                {pressedMenuId === item.id && item.description && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto bg-black/80 p-3">
                    <p className="text-xs leading-relaxed text-white sm:text-sm">
                      {item.description}
                    </p>
                  </div>
                )}

                <span className="absolute left-2 top-2 rounded-lg bg-green-900/85 px-3 py-1 text-[10px] font-semibold capitalize text-white sm:text-xs">
                  {item.category}
                </span>
              </div>

              <div className="p-3">
                <h3 className="line-clamp-2 min-h-10 text-sm font-bold text-gray-900 sm:text-base">
                  {item.name}
                </h3>

                {item.description && (
                  <p className="mt-1 line-clamp-2 min-h-10 text-xs leading-relaxed text-gray-500 sm:text-sm">
                    {item.description}
                  </p>
                )}

                <div className="mt-3 flex items-end justify-between gap-2 border-t border-gray-100 pt-3">
                  <div className="min-w-0">
                    <p className="text-[10px] text-gray-400 sm:text-xs">
                      HARGA
                    </p>

                    <p className="text-sm font-extrabold text-green-800 sm:text-base">
                      {rupiah(Number(item.price) || 0)}
                    </p>
                  </div>

                  <button
                    onClick={() => addToCart(item)}
                    className="shrink-0 rounded-lg bg-orange-500 px-2 py-2 text-[10px] font-bold text-white shadow-sm transition hover:bg-orange-600 sm:px-3 sm:py-2"
                  >
                    + Pesan
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>

        {orderError && (
          <div className="mt-4 rounded-xl bg-red-100 p-3 text-sm text-red-800">
            {orderError}
          </div>
        )}
      </section>

      <Cart
        items={cart}
        onAdd={addToCart}
        onRemove={removeFromCart}
        onContinue={() => startConfirmation(customerName.trim(), tableNumber)}
        canContinue={
          tableQrVerified &&
          Boolean(tableQrToken) &&
          Number.isInteger(tableNumber) &&
          tableNumber >= 1 &&
          tableNumber <= 50 &&
          /^[A-Za-z ]+$/.test(customerName.trim()) &&
          cart.length > 0
        }
      />

      {showConfirmation && (
        <OrderConfirmation
          name={customerName}
          table={tableNumber}
          items={orderItems}
          total={total}
          onConfirm={submitOrder}
          onCancel={() => setShowConfirmation(false)}
        />
      )}

      {sending && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="rounded-xl bg-white p-6 font-semibold">
            Mengirim pesanan...
          </div>
        </div>
      )}
    </main>
  );
}
