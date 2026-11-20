
import { useEffect, useState, type ChangeEvent } from 'react';
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc
} from 'firebase/firestore';
import { db } from '../firebase';
import { getAuth } from 'firebase/auth';
import type { MenuItem, PromoBanner } from '../types';
import QRCode from 'qrcode';

const rupiah = (value: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(Number(value) || 0);

type TableQrItem = {
  tableNumber: number;
  tableName: string;
  token: string;
  imageUrl: string;
};

type GeneratedQrResponse = {
  success: boolean;
  created: number;
  recovered: number;
  qrTokens: {
    tableNumber: number;
    token: string;
  }[];
  error?: string;
};

type PreviewTableOrder = {
  order_id: string;
  order_code: string | null;
  status: string | null;
  payment_status: string | null;
  table_session_id: string;
};

type PreviewTable = {
  table_number: number;
  table_name: string;
  document_exists: boolean;
  is_active: boolean | null;
  current_status: string | null;
  active_order_count: number;
  active_orders: PreviewTableOrder[];
  current_table_session_id: string | null;
  order_session_ids: string[];
  session_conflict: boolean;
  status_mismatch: boolean;
  recommended_status: string;
  needs_initialization: boolean;
};

type TablePreviewResponse = {
  success: boolean;
  mode: string;
  message: string;
  error?: string;
  summary: {
    total_tables: number;
    existing_documents: number;
    missing_documents: number;
    missing_status: number;
    occupied_recommendations: number;
    cleaning_recommendations: number;
    empty_current_status: number;
    active_orders_total: number;
    session_conflicts: number;
    status_mismatches: number;
    inactive_tables: number;
  };
  tables: PreviewTable[];
};

type OrderStatus =
  | 'menunggu'
  | 'diproses'
  | 'siap'
  | 'selesai'
  | 'dibatalkan';

type AdminOrderItem = {
  id: string;
  order_id: string;
  menu_id: string;
  item_name: string;
  item_price: number;
  quantity: number;
  subtotal: number;
};

type AdminOrder = {
  id: string;
  order_code: string;
  customer_name: string;
  table_number: number;
  status: OrderStatus;
  payment_status: 'belum_lunas' | 'lunas';
  payment_method?: string;
  total_amount: number;
  created_at: Date;
  table_session_id?: string;
  cashier_archived_at?: any;
  admin_archived_at?: any;
  admin_archived_by?: string;
  admin_trashed_at?: any;
  admin_trashed_by?: string;
  items: AdminOrderItem[];
};

type LiveTableRecord = {
  table_number: number;
  table_name: string;
  table_status?: string;
  table_session_id?: string;
};

type StaffProfile = {
  id: string;
  full_name: string;
  role: string;
  created_at?: Date | null;
};

const sectionClass =
  'min-w-0 scroll-mt-5 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm sm:p-5';

const inputClass =
  'mb-3 block min-w-0 w-full max-w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100';

const buttonClass =
  'w-full min-w-0 rounded-xl px-4 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50';

const orderStatusOptions: OrderStatus[] = [
  'menunggu',
  'diproses',
  'siap',
  'selesai',
  'dibatalkan'
];

function toDate(value: any): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value?.toDate === 'function') {
    const result = value.toDate();
    return result instanceof Date && !Number.isNaN(result.getTime())
      ? result
      : null;
  }

  const result = new Date(value);

  return Number.isNaN(result.getTime()) ? null : result;
}

function formatDate(value: Date | null | undefined) {
  if (!value) return '-';

  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(value);
}

function localDateString(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    menunggu: 'Menunggu',
    diproses: 'Diproses',
    siap: 'Siap',
    selesai: 'Selesai',
    dibatalkan: 'Dibatalkan'
  };

  return labels[status] || status || 'Tidak diketahui';
}

function statusClass(status: string) {
  const classes: Record<string, string> = {
    menunggu: 'bg-amber-100 text-amber-800',
    diproses: 'bg-blue-100 text-blue-800',
    siap: 'bg-indigo-100 text-indigo-800',
    selesai: 'bg-green-100 text-green-800',
    dibatalkan: 'bg-red-100 text-red-800'
  };

  return classes[status] || 'bg-slate-100 text-slate-700';
}

export default function AdminView() {
  const [wibClock, setWibClock] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('dashboard');

  useEffect(() => {
    const updateWibClock = () => {
      setWibClock(
        new Intl.DateTimeFormat('id-ID', {
          timeZone: 'Asia/Jakarta',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }).format(new Date())
      );
    };

    updateWibClock();
    const clockInterval = window.setInterval(updateWibClock, 1000);
    return () => window.clearInterval(clockInterval);
  }, []);
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('makanan');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [seedingTables, setSeedingTables] = useState(false);
  const [seedMessage, setSeedMessage] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<TablePreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [editingMenu, setEditingMenu] = useState<MenuItem | null>(null);
  const [existingImageUrl, setExistingImageUrl] = useState('');

  const [qrItems, setQrItems] = useState<TableQrItem[]>([]);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrMessage, setQrMessage] = useState('');

  const [banners, setBanners] = useState<PromoBanner[]>([]);
  const [bannerTitle, setBannerTitle] = useState('');
  const [bannerDescription, setBannerDescription] = useState('');
  const [bannerActive, setBannerActive] = useState(true);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreviewUrl, setBannerPreviewUrl] = useState('');
  const [bannerExistingImageUrl, setBannerExistingImageUrl] = useState('');
  const [editingBanner, setEditingBanner] = useState<PromoBanner | null>(null);
  const [bannerError, setBannerError] = useState('');
  const [bannerSaving, setBannerSaving] = useState(false);

  // Data pesanan dan rincian produk.
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [liveTables, setLiveTables] = useState<LiveTableRecord[]>([]);
  const [liveTablesLoaded, setLiveTablesLoaded] = useState(false);
  const [orderItems, setOrderItems] = useState<AdminOrderItem[]>([]);
  const [orderError, setOrderError] = useState('');
  const [orderMessage, setOrderMessage] = useState('');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderFilter, setOrderFilter] = useState('semua');
  const [archiveSearch, setArchiveSearch] = useState('');
  const [archiveDateFrom, setArchiveDateFrom] = useState('');
  const [archiveDateTo, setArchiveDateTo] = useState('');
  const [trashSearch, setTrashSearch] = useState('');
  const [trashDateFrom, setTrashDateFrom] = useState('');
  const [trashDateTo, setTrashDateTo] = useState('');
  const [expandedArchiveOrderId, setExpandedArchiveOrderId] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<Record<string, string>>({});
  const [processingOrderId, setProcessingOrderId] = useState('');
  const [processingArchiveOrderId, setProcessingArchiveOrderId] = useState('');
  const [processingTrashOrderId, setProcessingTrashOrderId] = useState('');
  const [selectedTrashOrderId, setSelectedTrashOrderId] = useState('');
  const [processingRestoreOrderId, setProcessingRestoreOrderId] = useState('');
  const [processingDeleteOrderId, setProcessingDeleteOrderId] = useState('');

  // Data akun staf.
  const [staffProfiles, setStaffProfiles] = useState<StaffProfile[]>([]);
  const [staffError, setStaffError] = useState('');

  const [cashierAccounts, setCashierAccounts] = useState<
    { uid: string; full_name: string; email: string; disabled: boolean }[]
  >([]);
  const [cashierAccountsLoading, setCashierAccountsLoading] = useState(false);
  const [cashierAccountsError, setCashierAccountsError] = useState('');

  const [selectedCashierId, setSelectedCashierId] = useState('');
  const [editingCashierName, setEditingCashierName] = useState('');
  const [editingCashierEmail, setEditingCashierEmail] = useState('');
  const [editingCashierPassword, setEditingCashierPassword] = useState('');
  const [showEditingCashierPassword, setShowEditingCashierPassword] = useState(false);
  const [savingCashierEdit, setSavingCashierEdit] = useState(false);
  const [cashierManagementMessage, setCashierManagementMessage] = useState('');
  const [cashierManagementError, setCashierManagementError] = useState('');
  const [processingCashierStatusId, setProcessingCashierStatusId] = useState('');

  const [cashierName, setCashierName] = useState('');
  const [cashierEmail, setCashierEmail] = useState('');
  const [cashierPassword, setCashierPassword] = useState('');
  const [showCashierPassword, setShowCashierPassword] = useState(false);
  const [creatingCashier, setCreatingCashier] = useState(false);
  const [cashierCreateMessage, setCashierCreateMessage] = useState('');
  const [cashierCreateError, setCashierCreateError] = useState('');

  const [cashierPresence, setCashierPresence] = useState<
    { id: string; full_name: string; lastSeen: number }[]
  >([]);
  const [presenceNow, setPresenceNow] = useState(Date.now());

  // Filter laporan.
  const today = localDateString(new Date());
  const [reportStart, setReportStart] = useState(today);
  const [reportEnd, setReportEnd] = useState(today);

  useEffect(() => {
    return onSnapshot(
      collection(db, 'menu_items'),
      (snapshot) => {
        setMenus(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data()
          })) as MenuItem[]
        );
      },
      (err) => {
        console.error(err);
        setError('Gagal membaca data menu.');
      }
    );
  }, []);

  useEffect(() => {
    return onSnapshot(
      collection(db, 'banners'),
      (snapshot) => {
        setBanners(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data()
          })) as PromoBanner[]
        );
      },
      (err) => {
        console.error(err);
        setBannerError(
          'Gagal membaca data banner. Periksa aturan akses Firestore.'
        );
      }
    );
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'orders'),
      (snapshot) => {
        const result = snapshot.docs.map((item) => {
          const raw = item.data();

          return {
            id: item.id,
            order_code: String(raw.order_code ?? ''),
            customer_name: String(raw.customer_name ?? ''),
            table_number: Number(raw.table_number ?? 0),
            status: String(raw.status ?? 'menunggu') as OrderStatus,
            payment_status:
              raw.payment_status === 'lunas' ? 'lunas' : 'belum_lunas',
            payment_method: String(raw.payment_method ?? ''),
            total_amount: Number(raw.total_amount ?? 0),
            created_at: toDate(raw.created_at) || new Date(0),
            table_session_id: String(raw.table_session_id ?? ''),
            cashier_archived_at: raw.cashier_archived_at ?? null,
            admin_archived_at: raw.admin_archived_at ?? null,
            admin_archived_by: String(raw.admin_archived_by ?? ''),
            admin_trashed_at: raw.admin_trashed_at ?? null,
            admin_trashed_by: String(raw.admin_trashed_by ?? ''),
            items: []
          } satisfies AdminOrder;
        });

        result.sort(
          (a, b) => b.created_at.getTime() - a.created_at.getTime()
        );

        setOrders(result);
        setOrderError('');
      },
      (err) => {
        console.error(err);
        setOrderError('Gagal membaca pesanan. Periksa akses data orders.');
      }
    );

    return unsubscribe;
  }, []);

  // Status meja dibaca realtime dan hanya ditampilkan oleh Admin.
  useEffect(() => {
    return onSnapshot(
      collection(db, 'restaurant_tables'),
      (snapshot) => {
        const result = snapshot.docs
          .map((item) => {
            const raw = item.data();
            const idNumber = Number(item.id.match(/\\d+/)?.[0] ?? 0);
            const tableNumber = Number(
              raw.table_number ?? raw.Table_number ?? idNumber
            );

            return {
              table_number: tableNumber,
              table_name: String(
                raw.table_name ?? `Meja ${String(tableNumber).padStart(2, '0')}`
              ),
              table_status: String(raw.table_status ?? ''),
              table_session_id: String(raw.table_session_id ?? '')
            };
          })
          .filter((table) =>
            Number.isInteger(table.table_number) &&
            table.table_number >= 1 &&
            table.table_number <= 50
          );

        setLiveTables(result);
        setLiveTablesLoaded(true);
      },
      (err) => {
        console.error('Gagal membaca status meja realtime:', err);
        setLiveTablesLoaded(false);
      }
    );
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'order_items'),
      (snapshot) => {
        setOrderItems(
          snapshot.docs.map((item) => {
            const raw = item.data();

            return {
              id: item.id,
              order_id: String(raw.order_id ?? ''),
              menu_id: String(raw.menu_id ?? ''),
              item_name: String(raw.item_name ?? ''),
              item_price: Number(raw.item_price ?? 0),
              quantity: Number(raw.quantity ?? 0),
              subtotal: Number(raw.subtotal ?? 0)
            };
          })
        );
      },
      (err) => {
        console.error(err);
        setOrderError(
          'Gagal membaca rincian pesanan. Periksa akses koleksi order_items.'
        );
      }
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'staff_profiles'),
      (snapshot) => {
        setStaffProfiles(
          snapshot.docs.map((item) => {
            const raw = item.data();

            return {
              id: item.id,
              full_name: String(raw.full_name ?? ''),
              role: String(raw.role ?? ''),
              created_at: toDate(raw.created_at)
            };
          })
        );

        setStaffError('');
      },
      (err) => {
        console.error(err);
        setStaffError(
          'Daftar akun staf tidak dapat dibaca. Periksa izin akses data staf.'
        );
      }
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadCashierAccounts = async () => {
      setCashierAccountsLoading(true);
      setCashierAccountsError('');

      try {
        const user = getAuth().currentUser;
        if (!user) throw new Error('Sesi login tidak ditemukan.');

        const token = await user.getIdToken(true);
        const response = await fetch('/api/list-cashiers', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({})
        });

        const result = await response.json();
        if (!response.ok || result.success !== true) {
          throw new Error(result.error || 'Daftar akun kasir gagal dimuat.');
        }

        if (!cancelled) {
          setCashierAccounts(
            Array.isArray(result.accounts) ? result.accounts : []
          );
        }
      } catch (error: any) {
        if (!cancelled) {
          setCashierAccountsError(
            error?.message || 'Daftar akun kasir gagal dimuat.'
          );
        }
      } finally {
        if (!cancelled) setCashierAccountsLoading(false);
      }
    };

    void loadCashierAccounts();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'cashier_presence'),
      (snapshot) => {
        setCashierPresence(
          snapshot.docs.map((item) => {
            const raw = item.data();
            return {
              id: item.id,
              full_name: String(raw.full_name ?? ''),
              lastSeen: raw.lastSeen?.toMillis?.() ?? 0
            };
          })
        );
      },
      (err) => {
        console.error('Gagal membaca kehadiran kasir:', err);
      }
    );

    const clock = window.setInterval(
      () => setPresenceNow(Date.now()),
      5000
    );

    return () => {
      unsubscribe();
      window.clearInterval(clock);
    };
  }, []);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl('');
      return;
    }

    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  useEffect(() => {
    if (!bannerFile) {
      setBannerPreviewUrl('');
      return;
    }

    const url = URL.createObjectURL(bannerFile);
    setBannerPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [bannerFile]);

  const handlePhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('File harus berupa foto.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Ukuran foto maksimal 5 MB.');
      return;
    }

    setError('');
    setSelectedFile(file);
  };

  const handleBannerPhotoChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setBannerError('File banner harus berupa foto.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setBannerError('Ukuran foto banner maksimal 5 MB.');
      return;
    }

    setBannerError('');
    setBannerFile(file);
  };

  const uploadImageToCloudinary = async (file: File): Promise<string> => {
    const formData = new FormData();

    formData.append('file', file);
    formData.append('upload_preset', 'waroeng_bpjs');

    const response = await fetch(
      'https://api.cloudinary.com/v1_1/irwzbli5/image/upload',
      {
        method: 'POST',
        body: formData
      }
    );

    const responseText = await response.text();
    let result: any;

    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error('Respons Cloudinary tidak valid.');
    }

    if (!response.ok || !result.secure_url) {
      console.error('Detail error Cloudinary:', result);

      throw new Error(
        `Cloudinary ${response.status}: ${
          result.error?.message || responseText
        }`
      );
    }

    return result.secure_url;
  };

  const seedRestaurantTables = async () => {
    setSeedingTables(true);
    setSeedMessage('');

    try {
      const user = getAuth().currentUser;

      if (!user) {
        throw new Error('Silakan login sebagai Admin terlebih dahulu.');
      }

      const token = await user.getIdToken(true);

      const response = await fetch('/api/seed-tables', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Gagal menyiapkan meja.');
      }

      setSeedMessage(
        `Berhasil! ${result.created} meja dibuat. ${result.alreadyExists} meja sudah tersedia.`
      );
    } catch (err) {
      setSeedMessage(
        err instanceof Error ? err.message : 'Gagal menyiapkan meja.'
      );
    } finally {
      setSeedingTables(false);
    }
  };

  const previewTableMigration = async () => {
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewResult(null);

    try {
      const user = getAuth().currentUser;

      if (!user) {
        throw new Error('Silakan login sebagai Admin terlebih dahulu.');
      }

      const token = await user.getIdToken(true);

      const response = await fetch('/api/preview-table-migration', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Gagal membaca pratinjau status meja.');
      }

      setPreviewResult(result as TablePreviewResponse);
    } catch (err) {
      setPreviewError(
        err instanceof Error
          ? err.message
          : 'Gagal membaca pratinjau status meja.'
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  const generateTableQrs = async () => {
    setQrLoading(true);
    setQrMessage('');
    setQrItems([]);

    try {
      const user = getAuth().currentUser;

      if (!user) {
        throw new Error('Silakan login sebagai Admin.');
      }

      const idToken = await user.getIdToken(true);

      const response = await fetch('/api/generate-table-qr', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        cache: 'no-store'
      });

      const result =
        (await response.json()) as GeneratedQrResponse;

      if (!response.ok || result.success !== true) {
        throw new Error(
          result.error || 'Gagal menyiapkan QR meja.'
        );
      }

      if (
        !Array.isArray(result.qrTokens) ||
        result.qrTokens.length !== 50
      ) {
        throw new Error('Data 50 QR tidak lengkap.');
      }

      const numbers = new Set<number>();
      const tokens = new Set<string>();

      for (const item of result.qrTokens) {
        if (
          !Number.isInteger(item.tableNumber) ||
          item.tableNumber < 1 ||
          item.tableNumber > 50 ||
          typeof item.token !== 'string' ||
          !/^[A-Za-z0-9_-]{43}$/.test(item.token) ||
          numbers.has(item.tableNumber) ||
          tokens.has(item.token)
        ) {
          throw new Error('Data QR tidak valid atau tidak unik.');
        }

        numbers.add(item.tableNumber);
        tokens.add(item.token);
      }

      if (numbers.size !== 50 || tokens.size !== 50) {
        throw new Error('50 QR harus memiliki nomor dan token unik.');
      }

      const sortedTokens = [...result.qrTokens].sort(
        (a, b) => a.tableNumber - b.tableNumber
      );

      const generatedItems = await Promise.all(
        sortedTokens.map(async (item) => {
          const tableCode = String(item.tableNumber).padStart(2, '0');
          const tableName = `Meja ${tableCode}`;

          const qrUrl =
            `https://new-waroeng-bpjs.vercel.app/?table=${tableCode}&token=${item.token}`;

          const imageUrl = await QRCode.toDataURL(qrUrl, {
            errorCorrectionLevel: 'H',
            margin: 2,
            width: 320
          });

          return {
            tableNumber: item.tableNumber,
            tableName,
            token: item.token,
            imageUrl
          };
        })
      );

      setQrItems(generatedItems);

      const created =
        Number.isInteger(result.created) && result.created >= 0
          ? result.created
          : 0;

      const recovered =
        Number.isInteger(result.recovered) && result.recovered >= 0
          ? result.recovered
          : 0;

      setQrMessage(
        `Berhasil! ${created} QR baru dibuat dan ${recovered} QR lama dipulihkan.`
      );
    } catch (err) {
      console.error(err);
      setQrItems([]);

      setQrMessage(
        err instanceof Error
          ? err.message
          : 'Gagal membuat QR meja.'
      );
    } finally {
      setQrLoading(false);
    }
  };

  const printTableQrs = () => {
    if (qrItems.length !== 50) {
      setQrMessage('Pastikan seluruh 50 QR sudah tersedia.');
      return;
    }

    const printWindow = window.open(
      '',
      '_blank',
      'width=1000,height=800'
    );

    if (!printWindow) {
      setQrMessage(
        'Jendela cetak diblokir. Izinkan pop-up pada browser.'
      );
      return;
    }

    const cards = qrItems.map((item) => `
      <article class="qr-card">
        <div class="brand">WAROENG BPJS</div>
        <div class="address">
          Jl Kandang Sapi 001/002 No 01 Desa Tanjungsari
          Kecamatan Sukaluyu Kabupaten Cianjur
        </div>
        <div class="scan">SCAN QR UNTUK MEMESAN</div>
        <div class="table-number">${item.tableName}</div>
        <img src="${item.imageUrl}" alt="${item.tableName}" />
        <div class="instruction">
          Pindai QR ini untuk memesan makanan dan minuman.
        </div>
      </article>
    `).join('');

    printWindow.document.open();

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>QR Meja WAROENG BPJS</title>
        <style>
          @page {
            size: A4;
            margin: 8mm;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            font-family: Arial, sans-serif;
            color: #111;
          }

          .grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 7mm;
          }

          .qr-card {
            border: 1px solid #333;
            border-radius: 8px;
            padding: 5mm 3mm;
            text-align: center;
            break-inside: avoid;
            page-break-inside: avoid;
            min-height: 65mm;
          }

          .brand {
            font-size: 12px;
            font-weight: 800;
          }

          .address {
            font-size: 7px;
            margin-top: 3px;
          }

          .scan {
            font-size: 10px;
            font-weight: 800;
            margin-top: 8px;
            white-space: nowrap;
          }

          .table-number {
            font-size: 21px;
            font-weight: 900;
            margin: 5px 0;
          }

          img {
            display: block;
            width: 38mm;
            height: 38mm;
            object-fit: contain;
            margin: 0 auto;
          }

          .instruction {
            font-size: 8px;
            margin-top: 5px;
          }

          @media screen {
            body {
              padding: 15px;
            }
          }
        </style>
      </head>
      <body>
        <div class="grid">${cards}</div>

        <script>
          window.onload = function() {
            setTimeout(function() {
              window.focus();
              window.print();
            }, 700);
          };
        </script>
      </body>
      </html>
    `);

    printWindow.document.close();
  };

  const addMenu = async () => {
    if (!name.trim() || !price || Number(price) <= 0) {
      setError('Nama dan harga menu wajib diisi dengan benar.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      let imageUrl = editingMenu
        ? existingImageUrl
        : '';

      if (selectedFile) {
        imageUrl = await uploadImageToCloudinary(selectedFile);
      }

      const productData = {
        name: name.trim(),
        category,
        price: Number(price),
        description: description.trim(),
        image_url: imageUrl
      };

      if (editingMenu) {
        await updateDoc(
          doc(db, 'menu_items', editingMenu.id),
          productData
        );

        alert('Produk berhasil diperbarui!');
      } else {
        await addDoc(collection(db, 'menu_items'), {
          ...productData,
          is_available: true
        });

        alert('Produk berhasil disimpan!');
      }

      cancelEdit();
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : 'Gagal menyimpan produk.'
      );
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (menu: MenuItem) => {
    setEditingMenu(menu);
    setName(menu.name);
    setCategory(menu.category);
    setPrice(String(menu.price));
    setDescription(menu.description || '');
    setSelectedFile(null);
    setExistingImageUrl(menu.image_url || '');
    setError('');

    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  const cancelEdit = () => {
    setEditingMenu(null);
    setName('');
    setCategory('makanan');
    setPrice('');
    setDescription('');
    setSelectedFile(null);
    setExistingImageUrl('');
    setError('');
  };

  const toggleAvailability = async (menu: MenuItem) => {
    try {
      await updateDoc(doc(db, 'menu_items', menu.id), {
        is_available: !menu.is_available
      });
    } catch (err) {
      console.error(err);
      setError('Gagal mengubah ketersediaan menu.');
    }
  };

  const removeMenu = async (menu: MenuItem) => {
    if (!window.confirm(`Hapus menu ${menu.name}?`)) return;

    try {
      await deleteDoc(doc(db, 'menu_items', menu.id));
    } catch (err) {
      console.error(err);
      setError('Gagal menghapus menu.');
    }
  };

  const saveBanner = async () => {
    if (!bannerTitle.trim()) {
      setBannerError('Judul banner wajib diisi.');
      return;
    }

    if (!bannerFile && !bannerExistingImageUrl) {
      setBannerError('Foto banner wajib dipilih.');
      return;
    }

    setBannerSaving(true);
    setBannerError('');

    try {
      let imageUrl = bannerExistingImageUrl;

      if (bannerFile) {
        imageUrl = await uploadImageToCloudinary(bannerFile);
      }

      const bannerData = {
        title: bannerTitle.trim(),
        description: bannerDescription.trim(),
        image_url: imageUrl,
        is_active: bannerActive
      };

      if (editingBanner) {
        await updateDoc(
          doc(db, 'banners', editingBanner.id),
          bannerData
        );

        alert('Banner berhasil diperbarui.');
      } else {
        await addDoc(collection(db, 'banners'), {
          ...bannerData,
          created_at: new Date()
        });

        alert('Banner berhasil ditambahkan.');
      }

      cancelBannerEdit();
    } catch (err) {
      console.error(err);

      setBannerError(
        err instanceof Error
          ? err.message
          : 'Gagal menyimpan banner.'
      );
    } finally {
      setBannerSaving(false);
    }
  };

  const startEditBanner = (banner: PromoBanner) => {
    setEditingBanner(banner);
    setBannerTitle(banner.title || '');
    setBannerDescription(banner.description || '');
    setBannerActive(banner.is_active === true);
    setBannerFile(null);
    setBannerExistingImageUrl(banner.image_url || '');
    setBannerError('');

    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  const cancelBannerEdit = () => {
    setEditingBanner(null);
    setBannerTitle('');
    setBannerDescription('');
    setBannerActive(true);
    setBannerFile(null);
    setBannerExistingImageUrl('');
    setBannerError('');
  };

  const toggleBannerStatus = async (banner: PromoBanner) => {
    try {
      await updateDoc(doc(db, 'banners', banner.id), {
        is_active: !banner.is_active
      });
    } catch (err) {
      console.error(err);
      setBannerError('Gagal mengubah status banner.');
    }
  };

  const removeBanner = async (banner: PromoBanner) => {
    if (!window.confirm(`Hapus banner "${banner.title}"?`)) return;

    try {
      await deleteDoc(doc(db, 'banners', banner.id));

      if (editingBanner?.id === banner.id) {
        cancelBannerEdit();
      }
    } catch (err) {
      console.error(err);
      setBannerError('Gagal menghapus banner.');
    }
  };

  // Menggabungkan dokumen orders dengan rincian order_items.
  const ordersWithItems: AdminOrder[] = orders.map((order) => ({
    ...order,
    items: orderItems.filter((item) => item.order_id === order.id)
  }));

  const filteredOrders = ordersWithItems.filter((order) => {
    const search = orderSearch.trim().toLowerCase();

    const matchesSearch =
      !search ||
      order.order_code.toLowerCase().includes(search) ||
      order.customer_name.toLowerCase().includes(search) ||
      String(order.table_number).includes(search);

    const matchesFilter =
      orderFilter === 'semua' ||
      (orderFilter === 'belum_lunas' &&
        order.payment_status === 'belum_lunas') ||
      (orderFilter === 'lunas' &&
        order.payment_status === 'lunas') ||
      order.status === orderFilter;

    return !order.admin_archived_at && !order.admin_trashed_at && matchesSearch && matchesFilter;
  });

  const archivedOrders = ordersWithItems.filter((order) => {
    if (!order.admin_archived_at || order.admin_trashed_at) return false;

    const search = archiveSearch.trim().toLowerCase();
    const matchesSearch =
      !search ||
      order.order_code.toLowerCase().includes(search) ||
      order.customer_name.toLowerCase().includes(search) ||
      String(order.table_number).includes(search);

    const orderDate = localDateString(order.created_at);
    const matchesFrom = !archiveDateFrom || orderDate >= archiveDateFrom;
    const matchesTo = !archiveDateTo || orderDate <= archiveDateTo;

    return matchesSearch && matchesFrom && matchesTo;
  });

  const trashedOrders = ordersWithItems.filter((order) => {
    if (!order.admin_trashed_at) return false;

    const search = trashSearch.trim().toLowerCase();
    const matchesSearch =
      !search ||
      order.order_code.toLowerCase().includes(search) ||
      order.customer_name.toLowerCase().includes(search) ||
      String(order.table_number).includes(search);

    const orderDate = localDateString(order.created_at);
    const matchesFrom = !trashDateFrom || orderDate >= trashDateFrom;
    const matchesTo = !trashDateTo || orderDate <= trashDateTo;

    return matchesSearch && matchesFrom && matchesTo;
  });

  const archivedOrdersByYear = archivedOrders.reduce<
    Record<string, Record<string, AdminOrder[]>>
  >((groups, order) => {
    const year = String(order.created_at.getFullYear());
    const month = String(order.created_at.getMonth() + 1).padStart(2, '0');
    groups[year] ??= {};
    groups[year][month] ??= [];
    groups[year][month].push(order);
    return groups;
  }, {});

  const updateOrderStatus = async (
    order: AdminOrder,
    nextStatus: OrderStatus
  ) => {
    setOrderMessage('');
    setProcessingOrderId(order.id);

    try {
      await updateDoc(doc(db, 'orders', order.id), {
        status: nextStatus
      });

      setOrderMessage(
        `Status pesanan ${order.order_code || order.id} berhasil diperbarui.`
      );
    } catch (err) {
      console.error(err);
      setOrderMessage(
        'Status pesanan gagal diperbarui. Periksa izin perubahan status pesanan.'
      );
    } finally {
      setProcessingOrderId('');
    }
  };

  const trashOrder = async (order: AdminOrder) => {
    const confirmed = window.confirm(
      `Pindahkan pesanan ${order.order_code || order.id} ke Sampah?`
    );
    if (!confirmed) return;

    setOrderMessage('');
    setProcessingTrashOrderId(order.id);

    try {
      const user = getAuth().currentUser;
      if (!user) {
        throw new Error('Sesi login tidak ditemukan. Silakan login kembali.');
      }

      const token = await user.getIdToken(true);
      const response = await fetch('/api/trash-order', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        cache: 'no-store',
        body: JSON.stringify({ order_id: order.id })
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Pesanan gagal dipindahkan ke Sampah.');
      }

      setOrderMessage(
        `Pesanan ${order.order_code || order.id} berhasil dipindahkan ke Sampah.`
      );
    } catch (error: any) {
      setOrderMessage(
        error?.message || 'Pesanan gagal dipindahkan ke Sampah.'
      );
    } finally {
      setProcessingTrashOrderId('');
    }
  };

  const restoreOrder = async (order: AdminOrder) => {
    const confirmed = window.confirm(
      `Pulihkan pesanan ${order.order_code || order.id} ke Manajemen Pesanan?`
    );
    if (!confirmed) return;

    setOrderMessage('');
    setProcessingRestoreOrderId(order.id);

    try {
      const user = getAuth().currentUser;
      if (!user) {
        throw new Error('Sesi login tidak ditemukan. Silakan login kembali.');
      }

      const token = await user.getIdToken(true);
      const response = await fetch('/api/restore-order', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        cache: 'no-store',
        body: JSON.stringify({ order_id: order.id })
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Pesanan gagal dipulihkan dari Sampah.');
      }

      setSelectedTrashOrderId('');
      setOrderMessage(
        `Pesanan ${order.order_code || order.id} berhasil dipulihkan ke Manajemen Pesanan.`
      );
    } catch (error: any) {
      setOrderMessage(
        error?.message || 'Pesanan gagal dipulihkan dari Sampah.'
      );
    } finally {
      setProcessingRestoreOrderId('');
    }
  };

  const permanentlyDeleteOrder = async (order: AdminOrder) => {
    const confirmed = window.confirm(
      `PERINGATAN: Hapus permanen pesanan ${order.order_code || order.id} milik ${order.customer_name}? Data pesanan dan seluruh rincian itemnya tidak dapat dikembalikan.`
    );
    if (!confirmed) return;

    setOrderMessage('');
    setProcessingDeleteOrderId(order.id);

    try {
      const user = getAuth().currentUser;
      if (!user) {
        throw new Error('Sesi login tidak ditemukan. Silakan login kembali.');
      }

      const token = await user.getIdToken(true);
      const response = await fetch('/api/delete-trashed-order', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        cache: 'no-store',
        body: JSON.stringify({ order_id: order.id })
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Pesanan gagal dihapus permanen.');
      }

      setSelectedTrashOrderId('');
      setOrderMessage(
        `Pesanan ${order.order_code || order.id} dan ${result.deletedItems} rincian item berhasil dihapus permanen.`
      );
    } catch (error: any) {
      setOrderMessage(
        error?.message || 'Pesanan gagal dihapus permanen.'
      );
    } finally {
      setProcessingDeleteOrderId('');
    }
  };

  const archiveOrder = async (order: AdminOrder) => {
    const confirmed = window.confirm(
      `Pindahkan pesanan ${order.order_code || order.id} ke Arsip Pesanan?`
    );
    if (!confirmed) return;

    setOrderMessage('');
    setProcessingArchiveOrderId(order.id);

    try {
      const user = getAuth().currentUser;
      if (!user) {
        throw new Error('Sesi login tidak ditemukan. Silakan login kembali.');
      }

      const idToken = await user.getIdToken(true);
      const response = await fetch('/api/archive-order', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        cache: 'no-store',
        body: JSON.stringify({ order_id: order.id })
      });

      const result = await response.json();
      if (!response.ok || result.success !== true) {
        throw new Error(result.error || 'Pesanan gagal dipindahkan ke Arsip.');
      }

      setOrderMessage(
        `Pesanan ${order.order_code || order.id} berhasil dipindahkan ke Arsip.`
      );
    } catch (err) {
      console.error(err);
      setOrderMessage(
        err instanceof Error ? err.message : 'Pesanan gagal dipindahkan ke Arsip.'
      );
    } finally {
      setProcessingArchiveOrderId('');
    }
  };

  const recordOrderPayment = async (order: AdminOrder) => {
    setOrderMessage('');
    setProcessingOrderId(order.id);

    try {
      const user = getAuth().currentUser;

      if (!user) {
        throw new Error('Sesi login tidak ditemukan. Silakan login kembali.');
      }

      const idToken = await user.getIdToken(true);
      const paymentMethod = paymentMethods[order.id] || 'tunai';

      const response = await fetch('/api/record-payment', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        cache: 'no-store',
        body: JSON.stringify({
          order_id: order.id,
          payment_method: paymentMethod
        })
      });

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(
          result.error || 'Pembayaran gagal dicatat.'
        );
      }

      setOrderMessage(
        `Pembayaran pesanan ${order.order_code || order.id} berhasil dicatat sebagai LUNAS.`
      );
    } catch (err) {
      console.error(err);
      setOrderMessage(
        err instanceof Error
          ? err.message
          : 'Pembayaran gagal dicatat.'
      );
    } finally {
      setProcessingOrderId('');
    }
  };

  const activeBannerCount = banners.filter(
    (banner) => banner.is_active
  ).length;

  // Data empat diagram Dashboard berdasarkan tanggal WIB.
  const todayWib = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

  const todayOrders = ordersWithItems.filter((order) => {
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(order.created_at);

    return date === todayWib;
  });

  const paidTodayOrders = todayOrders.filter(
    (order) => order.payment_status === 'lunas'
  );

  const unpaidTodayOrders = todayOrders.filter(
    (order) => order.payment_status === 'belum_lunas'
  );

  const todayRevenue = paidTodayOrders.reduce(
    (total, order) => total + (Number(order.total_amount) || 0),
    0
  );

  const revenuePercent = Math.min(100, todayRevenue / 1000000 * 100);
  const todayOrderCount = todayOrders.length;
  const orderPercent = Math.min(100, todayOrderCount);

  const todayPaidCount = paidTodayOrders.length;
  const todayUnpaidCount = unpaidTodayOrders.length;
  const paymentTotal = todayPaidCount + todayUnpaidCount;
  const paidPercent = paymentTotal
    ? todayPaidCount / paymentTotal * 100
    : 0;

  const menuTodayCounts = menus.map((menu) => {
    const quantity = paidTodayOrders.reduce((total, order) => {
      return total + order.items.reduce((itemTotal, item) => {
        const matchesMenu = item.menu_id != null
          ? String(item.menu_id) === String(menu.id)
          : item.item_name === menu.name;

        return itemTotal + (matchesMenu ? Number(item.quantity) || 0 : 0);
      }, 0);
    }, 0);

    return { ...menu, soldQuantity: quantity };
  });

  const totalMenuSold = menuTodayCounts.reduce(
    (total, menu) => total + menu.soldQuantity,
    0
  );

  const menuTarget = menus.length * 100;
  const menuPercent = menuTarget
    ? Math.min(100, totalMenuSold / menuTarget * 100)
    : 0;

  // Laporan memakai data Firestore realtime.
  // Pesanan Arsip tetap dihitung, sedangkan pesanan Sampah dikecualikan.
  const reportOrders = ordersWithItems.filter((order) => {
    if (order.admin_trashed_at) return false;

    const date = localDateString(order.created_at);

    if (reportStart && date < reportStart) return false;
    if (reportEnd && date > reportEnd) return false;

    return true;
  });

  const paidOrders = reportOrders.filter(
    (order) => order.payment_status === 'lunas'
  );

  const unpaidOrders = reportOrders.filter(
    (order) => order.payment_status === 'belum_lunas'
  );

  const paidRevenue = paidOrders.reduce(
    (total, order) => total + order.total_amount,
    0
  );

  const unpaidTotal = unpaidOrders.reduce(
    (total, order) => total + order.total_amount,
    0
  );

  const completedOrders = reportOrders.filter(
    (order) => order.status === 'selesai'
  ).length;

  // Rekap omzet lunas per tanggal untuk diagram batang laporan.
  const dailyRevenue = paidOrders.reduce<Record<string, number>>(
    (totals, order) => {
      const date = localDateString(order.created_at);
      totals[date] = (totals[date] || 0) + order.total_amount;
      return totals;
    },
    {}
  );

  const dailyRevenueEntries = Object.entries(dailyRevenue).sort(
    ([dateA], [dateB]) => dateA.localeCompare(dateB)
  );

  const maxDailyRevenue = Math.max(
    1,
    ...dailyRevenueEntries.map(([, amount]) => amount)
  );

  const navigation = [
    { id: 'dashboard', label: 'Dashboard Admin' },
    { id: 'menu-admin', label: 'Manajemen Menu' },
    { id: 'meja-admin', label: 'Manajemen Meja' },
    { id: 'pesanan-admin', label: 'Manajemen Pesanan' },
    { id: 'arsip-pesanan-admin', label: 'Arsip Pesanan' },
    { id: 'sampah-admin', label: 'Sampah' },
    { id: 'laporan-admin', label: 'Laporan Penjualan' },
    { id: 'akun-admin', label: 'Manajemen Kasir' },
    { id: 'pengaturan-admin', label: 'Pengaturan Restoran' }
  ];
  const activePageTitle = navigation.find((item) => item.id === activeSection)?.label || 'Dashboard Admin';

  const liveTableStatuses = Array.from({ length: 50 }, (_, index) => {
    const tableNumber = index + 1;
    const record = liveTables.find(
      (table) => table.table_number === tableNumber
    );
    const storedStatus = record?.table_status;
    const tableSessionId = String(record?.table_session_id || '').trim();

    const tableOrders = orders.filter((order) => {
      if (
        Number(order.table_number) !== tableNumber ||
        order.cashier_archived_at ||
        order.admin_archived_at ||
        order.admin_trashed_at ||
        storedStatus === 'kosong'
      ) return false;

      const orderSessionId = String(order.table_session_id || '').trim();

      if (tableSessionId || orderSessionId) {
        return Boolean(
          tableSessionId &&
          orderSessionId &&
          tableSessionId === orderSessionId
        );
      }

      return true;
    });

    const validStoredStatus = [
      'terisi',
      'perlu_dibersihkan',
      'kosong'
    ].includes(storedStatus || '');

    const status = validStoredStatus
      ? storedStatus!
      : tableOrders.length > 0
        ? 'terisi'
        : 'perlu_dibersihkan';

    return {
      tableNumber,
      tableName: record?.table_name ||
        `Meja ${String(tableNumber).padStart(2, '0')}`,
      status
    };
  });

  const handleCreateCashier = async () => {
    setCashierCreateMessage('');
    setCashierCreateError('');

    const fullName = cashierName.trim();
    const email = cashierEmail.trim().toLowerCase();

    if (fullName.length < 2 || fullName.length > 80) {
      setCashierCreateError('Nama lengkap harus 2–80 karakter.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setCashierCreateError('Masukkan alamat email yang valid.');
      return;
    }

    if (cashierPassword.length < 8) {
      setCashierCreateError('Kata sandi minimal 8 karakter.');
      return;
    }

    const user = getAuth().currentUser;
    if (!user) {
      setCashierCreateError('Sesi Admin tidak ditemukan. Silakan masuk kembali.');
      return;
    }

    setCreatingCashier(true);

    try {
      const token = await user.getIdToken(true);
      const response = await fetch('/api/create-cashier', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          full_name: fullName,
          email,
          password: cashierPassword
        })
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Akun kasir gagal dibuat.');
      }

      setCashierName('');
      setCashierEmail('');
      setCashierPassword('');
      setShowCashierPassword(false);
      setCashierCreateMessage(`Akun kasir ${fullName} berhasil dibuat.`);
    } catch (error) {
      setCashierCreateError(
        error instanceof Error ? error.message : 'Terjadi kesalahan saat membuat akun.'
      );
    } finally {
      setCreatingCashier(false);
    }
  };

  const handleSelectCashier = (account: {
    uid: string;
    full_name: string;
    email: string;
    disabled: boolean;
  }) => {
    const profile = staffProfiles.find((item) => item.id === account.uid);
    if (!profile || profile.role.trim().toLowerCase() !== 'kasir') return;

    setSelectedCashierId(account.uid);
    setEditingCashierName(account.full_name);
    setEditingCashierEmail(account.email);
    setEditingCashierPassword('');
    setShowEditingCashierPassword(false);
    setCashierManagementMessage('');
    setCashierManagementError('');
  };

  const handleUpdateCashier = async () => {
    setCashierManagementMessage('');
    setCashierManagementError('');

    const account = cashierAccounts.find(
      (item) => item.uid === selectedCashierId
    );
    const profile = staffProfiles.find(
      (item) => item.id === selectedCashierId
    );

    if (!account || !profile || profile.role.trim().toLowerCase() !== 'kasir') {
      setCashierManagementError('Pilih akun kasir yang valid terlebih dahulu.');
      return;
    }

    const fullName = editingCashierName.trim();
    const email = editingCashierEmail.trim().toLowerCase();

    if (fullName.length < 2 || fullName.length > 80) {
      setCashierManagementError('Nama lengkap harus 2–80 karakter.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setCashierManagementError('Masukkan alamat email yang valid.');
      return;
    }

    if (
      editingCashierPassword &&
      (editingCashierPassword.length < 8 || editingCashierPassword.length > 128)
    ) {
      setCashierManagementError('Kata sandi baru harus 8–128 karakter.');
      return;
    }

    const user = getAuth().currentUser;
    if (!user) {
      setCashierManagementError('Sesi Admin tidak ditemukan. Silakan masuk kembali.');
      return;
    }

    setSavingCashierEdit(true);

    try {
      const token = await user.getIdToken(true);
      const body: {
        uid: string;
        full_name: string;
        email: string;
        password?: string;
      } = {
        uid: account.uid,
        full_name: fullName,
        email
      };

      if (editingCashierPassword) {
        body.password = editingCashierPassword;
      }

      const response = await fetch('/api/update-cashier', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Perubahan akun kasir gagal disimpan.');
      }

      setCashierAccounts((current) =>
        current.map((item) =>
          item.uid === account.uid
            ? { ...item, full_name: fullName, email }
            : item
        )
      );
      setStaffProfiles((current) =>
        current.map((item) =>
          item.id === account.uid ? { ...item, full_name: fullName } : item
        )
      );
      setEditingCashierPassword('');
      setShowEditingCashierPassword(false);
      setCashierManagementMessage('Data akun kasir berhasil diperbarui.');
    } catch (error) {
      setCashierManagementError(
        error instanceof Error ? error.message : 'Terjadi kesalahan saat memperbarui akun.'
      );
    } finally {
      setSavingCashierEdit(false);
    }
  };

  const handleToggleCashierStatus = async (account: {
    uid: string;
    full_name: string;
    email: string;
    disabled: boolean;
  }) => {
    const profile = staffProfiles.find((item) => item.id === account.uid);
    if (!profile || profile.role.trim().toLowerCase() !== 'kasir') {
      setCashierManagementError('Hanya akun kasir yang dapat diubah statusnya.');
      return;
    }

    const nextDisabled = !account.disabled;
    const action = nextDisabled ? 'menonaktifkan' : 'mengaktifkan kembali';

    if (!window.confirm(
      `Apakah Anda yakin ingin ${action} akun kasir ${account.full_name}?`
    )) return;

    setCashierManagementMessage('');
    setCashierManagementError('');
    setProcessingCashierStatusId(account.uid);

    try {
      const user = getAuth().currentUser;
      if (!user) throw new Error('Sesi Admin tidak ditemukan. Silakan masuk kembali.');

      const token = await user.getIdToken(true);
      const response = await fetch('/api/set-cashier-status', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          uid: account.uid,
          disabled: nextDisabled
        })
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Status akun kasir gagal diperbarui.');
      }

      setCashierAccounts((current) =>
        current.map((item) =>
          item.uid === account.uid
            ? { ...item, disabled: nextDisabled }
            : item
        )
      );
      setCashierManagementMessage(
        nextDisabled
          ? 'Akun kasir berhasil dinonaktifkan.'
          : 'Akun kasir berhasil diaktifkan kembali.'
      );
    } catch (error) {
      setCashierManagementError(
        error instanceof Error ? error.message : 'Terjadi kesalahan saat mengubah status akun.'
      );
    } finally {
      setProcessingCashierStatusId('');
    }
  };

  return (



    <main className="min-h-screen w-full min-w-0 overflow-x-clip bg-slate-50 p-2 sm:p-4 lg:p-5">
      <div className="mx-auto w-full min-w-0 max-w-[1600px]">

        <header className="mb-4 flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm sm:mb-5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-5">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              className="mb-3 rounded-lg bg-green-900 px-4 py-2 text-sm font-bold text-white hover:bg-green-800 lg:hidden"
            >
              Menu
            </button>
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-green-700">
              WAROENG BPJS
            </p>
            <h1 className="mt-1 break-words text-xl font-extrabold text-slate-900 sm:text-2xl">
              {activePageTitle}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Pusat pengelolaan restoran
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-center">
              <p className="text-[10px] font-bold uppercase tracking-widest text-green-700">
                Waktu Indonesia Barat
              </p>
              <p className="mt-1 font-mono text-xl font-extrabold tabular-nums text-green-900">
                {wibClock || '--:--:--'} WIB
              </p>
            </div>

            <div className="flex min-w-0 items-center gap-3 rounded-xl bg-green-50 px-3 py-3 sm:px-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-800 text-lg font-bold text-white">
                A
              </div>
            <div className="min-w-0">
              <p className="break-words text-sm font-bold text-green-900">
                Administrator
              </p>
              <p className="text-xs text-green-700">
                Panel Admin
              </p>
            </div>
            </div>
          </div>
        </header>

        <div className="relative grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-5">

          {isSidebarOpen && (
            <button
              type="button"
              aria-label="Tutup menu"
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            />
          )}

          <aside className={`fixed inset-y-0 left-0 z-50 h-full w-[min(82vw,300px)] overflow-y-auto rounded-r-2xl bg-green-950 p-3 text-white shadow-xl transition-transform duration-300 sm:p-4 lg:sticky lg:top-4 lg:z-auto lg:h-fit lg:w-auto lg:translate-x-0 lg:rounded-2xl lg:shadow-sm ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="mb-3 rounded-lg border border-green-700 px-3 py-2 text-xs font-semibold text-green-100 lg:hidden"
            >
              Tutup Menu
            </button>
            <p className="mb-3 px-1 text-xs font-bold uppercase tracking-widest text-green-300 sm:px-3">
              Menu Utama
            </p>

            <nav className="grid min-w-0 grid-cols-1 gap-1.5">
              {navigation.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveSection(item.id);
                    setIsSidebarOpen(false);
                  }}
                  className={`flex min-w-0 w-full items-center whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition ${activeSection === item.id ? 'bg-green-700 text-white' : 'text-green-50 hover:bg-green-800 hover:text-white'}`}
                >
                  <span className="whitespace-nowrap">{item.label}</span>
                </button>
              ))}
            </nav>

            <div className="mt-5 hidden rounded-xl border border-green-800 bg-green-900/50 p-3 lg:block">
              <p className="text-xs font-semibold text-green-200">
                Status panel
              </p>
              <p className="mt-1 text-sm font-bold text-white">
                Terhubung ke data
              </p>
              <p className="mt-1 text-xs leading-relaxed text-green-300">
                Data menu, banner, pesanan, dan akun staf dibaca dari Firestore.
              </p>
            </div>
          </aside>

          <div className="min-w-0 space-y-4 sm:space-y-5">

            {/* DASHBOARD */}
                        {activeSection === 'dashboard' && (
<section id="dashboard" className="min-w-0 scroll-mt-5">
              <div className="mb-4">
                <h2 className="text-xl font-extrabold text-slate-900">
                  Dashboard Admin
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Ringkasan diagram penjualan dan pesanan hari ini.
                </p>
              </div>

              <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
                {/* DIAGRAM 1: OMZET */}
                <article className="min-w-0 rounded-2xl border border-green-100 bg-white p-4 shadow-sm sm:p-5">
                  <h3 className="font-bold text-slate-900">
                    1. Persentase Omzet Harian
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Target omzet Rp1.000.000 setiap hari
                  </p>
                  <div className="flex flex-col items-center gap-4 py-5 sm:flex-row sm:justify-center">
                    <div
                      className="flex h-36 w-36 shrink-0 items-center justify-center rounded-full p-[18px]"
                      style={{ background: `conic-gradient(#16a34a ${revenuePercent}%, #e2e8f0 0)` }}
                    >
                      <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-white text-center">
                        <p className="text-xs font-semibold text-slate-500">Omzet hari ini</p>
                        <p className="mt-1 text-sm font-extrabold text-green-700">{revenuePercent.toFixed(1)}%</p>
                        <p className="text-[10px] text-slate-500">Rp{todayRevenue.toLocaleString('id-ID')}</p>
                      </div>
                    </div>
                    <div className="w-full min-w-0 space-y-3 sm:max-w-[190px]">
                      <div className="flex items-start gap-2 text-sm">
                        <span className="mt-1 h-3 w-3 shrink-0 rounded-sm bg-green-600" />
                        <div>
                          <p className="font-semibold text-slate-800">Omzet tercapai</p>
                          <p className="text-xs text-slate-500">Rp{todayRevenue.toLocaleString('id-ID')} ({revenuePercent.toFixed(1)}%)</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2 text-sm">
                        <span className="mt-1 h-3 w-3 shrink-0 rounded-sm bg-slate-200" />
                        <div>
                          <p className="font-semibold text-slate-800">Sisa target</p>
                          <p className="text-xs text-slate-500">Rp{Math.max(0, 1000000 - todayRevenue).toLocaleString('id-ID')}</p>
                        </div>
                      </div>
                      <p className="text-xs text-slate-400">Omzet dihitung dari transaksi LUNAS.</p>
                    </div>
                  </div>
                </article>

                {/* DIAGRAM 2: MENU */}
                <article className="min-w-0 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
                  <h3 className="font-bold text-slate-900">
                    2. Persentase Menu Terjual
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Target 100 porsi untuk setiap menu per hari
                  </p>
                  <div className="flex flex-col items-center gap-4 py-5 sm:flex-row sm:items-start sm:justify-center">
                    <div
                      className="flex h-36 w-36 shrink-0 items-center justify-center rounded-full p-[18px]"
                      style={{ background: `conic-gradient(#2563eb ${menuPercent}%, #e2e8f0 0)` }}
                    >
                      <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-white text-center">
                        <p className="text-xs font-semibold text-slate-500">Total porsi</p>
                        <p className="mt-1 text-sm font-extrabold text-blue-700">{totalMenuSold}</p>
                        <p className="text-[10px] text-slate-500">{menuPercent.toFixed(1)}% target</p>
                      </div>
                    </div>
                    <div className="w-full min-w-0 space-y-2 sm:max-w-[210px]">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Keterangan setiap menu
                      </p>
                      {menuTodayCounts.length > 0 ? menuTodayCounts.map((menu, index) => {
                        const menuColors = [
                          '#2563EB', '#16A34A', '#D97706', '#9333EA',
                          '#E11D48', '#0891B2', '#65A30D', '#C026D3',
                          '#EA580C', '#4F46E5', '#0D9488', '#DB2777'
                        ];
                        return (
                          <div key={menu.id ?? index} className="flex min-w-0 items-center gap-2 text-xs">
                            <span
                              className="h-3 w-3 shrink-0 rounded-sm"
                              style={{ backgroundColor: menuColors[index % menuColors.length] }}
                            />
                            <span className="min-w-0 flex-1 break-words font-medium text-slate-700">
                              {menu.name}
                            </span>
                            <span className="shrink-0 text-slate-500">{menu.soldQuantity}/100 ({Math.min(100, menu.soldQuantity).toFixed(0)}%)</span>
                          </div>
                        );
                      }) : (
                        <p className="text-xs text-slate-400">Daftar menu akan ditampilkan di sini.</p>
                      )}
                      <p className="pt-1 text-xs text-slate-400">
                        Setiap menu memiliki warna dan persentase pencapaian sendiri.
                      </p>
                    </div>
                  </div>
                </article>

                {/* DIAGRAM 3: PEMBAYARAN */}
                <article className="min-w-0 rounded-2xl border border-purple-100 bg-white p-4 shadow-sm sm:p-5">
                  <h3 className="font-bold text-slate-900">
                    3. Persentase Status Pembayaran
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Perbandingan seluruh pesanan hari ini
                  </p>
                  <div className="flex flex-col items-center gap-4 py-5 sm:flex-row sm:justify-center">
                    <div
                      className="flex h-36 w-36 shrink-0 items-center justify-center rounded-full p-[18px]"
                      style={{ background: `conic-gradient(#16a34a ${paidPercent}%, #dc2626 0)` }}
                    >
                      <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-white text-center">
                        <p className="text-xs font-semibold text-slate-500">Total pesanan</p>
                        <p className="mt-1 text-lg font-extrabold text-slate-800">{paymentTotal}</p>
                        <p className="text-[10px] text-slate-500">Transaksi hari ini</p>
                      </div>
                    </div>
                    <div className="w-full min-w-0 space-y-3 sm:max-w-[190px]">
                      <div className="flex items-start gap-2 text-sm">
                        <span className="mt-1 h-3 w-3 shrink-0 rounded-sm bg-green-600" />
                        <div>
                          <p className="font-semibold text-slate-800">LUNAS</p>
                          <p className="text-xs text-slate-500">{todayPaidCount} transaksi ({paidPercent.toFixed(1)}%)</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2 text-sm">
                        <span className="mt-1 h-3 w-3 shrink-0 rounded-sm bg-red-600" />
                        <div>
                          <p className="font-semibold text-slate-800">BELUM LUNAS</p>
                          <p className="text-xs text-slate-500">{todayUnpaidCount} transaksi ({(100 - paidPercent).toFixed(1)}%)</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>

                {/* DIAGRAM 4: JUMLAH PESANAN */}
                <article className="min-w-0 rounded-2xl border border-amber-100 bg-white p-4 shadow-sm sm:p-5">
                  <h3 className="font-bold text-slate-900">
                    4. Persentase Jumlah Pesanan
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Target 100 pesanan yang masuk setiap hari
                  </p>
                  <div className="flex flex-col items-center gap-4 py-5 sm:flex-row sm:justify-center">
                    <div
                      className="flex h-36 w-36 shrink-0 items-center justify-center rounded-full p-[18px]"
                      style={{ background: `conic-gradient(#f59e0b ${orderPercent}%, #e2e8f0 0)` }}
                    >
                      <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-white text-center">
                        <p className="text-xs font-semibold text-slate-500">Pesanan hari ini</p>
                        <p className="mt-1 text-lg font-extrabold text-amber-700">{todayOrderCount}</p>
                        <p className="text-[10px] text-slate-500">{orderPercent.toFixed(1)}% target</p>
                      </div>
                    </div>
                    <div className="w-full min-w-0 space-y-3 sm:max-w-[190px]">
                      <div className="flex items-start gap-2 text-sm">
                        <span className="mt-1 h-3 w-3 shrink-0 rounded-sm bg-amber-500" />
                        <div>
                          <p className="font-semibold text-slate-800">Pesanan masuk</p>
                          <p className="text-xs text-slate-500">{todayOrderCount} pesanan ({orderPercent.toFixed(1)}%)</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2 text-sm">
                        <span className="mt-1 h-3 w-3 shrink-0 rounded-sm bg-slate-200" />
                        <div>
                          <p className="font-semibold text-slate-800">Sisa target</p>
                          <p className="text-xs text-slate-500">{Math.max(0, 100 - todayOrderCount)} pesanan</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              </div>

              <section className={`${sectionClass} mt-6`}>
                <h3 className="mb-4 text-lg font-extrabold text-slate-900">
                  Kasir Sedang Online
                </h3>
                <div className="flex flex-wrap gap-x-5 gap-y-3">
                  {cashierPresence
                    .filter(
                      (cashier) =>
                        cashier.full_name.trim() &&
                        cashier.lastSeen > presenceNow - 45000
                    )
                    .map((cashier) => (
                      <div
                        key={cashier.id}
                        className="flex items-center gap-2 text-sm font-semibold text-slate-800"
                      >
                        <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
                        <span>{cashier.full_name}</span>
                      </div>
                    ))}
                </div>
              </section>

              <section className={`${sectionClass} mt-6`}>
                <div className="mb-4">
                  <h3 className="text-lg font-extrabold text-slate-900">
                    REALTIME PANEL MEJA
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Pemantauan status 50 meja. Status diperbarui otomatis dari aktivitas Kasir.
                  </p>
                </div>

                {!liveTablesLoaded ? (
                  <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                    Status meja sedang dimuat atau belum dapat dibaca.
                  </p>
                ) : (
                  <>
                    <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold">
                      <span className="flex items-center gap-2 text-red-700">
                        <span className="h-3 w-3 rounded-sm bg-red-600" /> TERISI
                      </span>
                      <span className="flex items-center gap-2 text-amber-700">
                        <span className="h-3 w-3 rounded-sm bg-amber-400" /> PERLU DIBERSIHKAN
                      </span>
                      <span className="flex items-center gap-2 text-green-700">
                        <span className="h-3 w-3 rounded-sm bg-green-600" /> KOSONG
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-10">
                      {liveTableStatuses.map((table) => {
                        const colorClass =
                          table.status === 'terisi'
                            ? 'border-red-200 bg-red-50 text-red-800'
                            : table.status === 'kosong'
                              ? 'border-green-200 bg-green-50 text-green-800'
                              : 'border-amber-200 bg-amber-50 text-amber-800';
                        const label =
                          table.status === 'terisi'
                            ? 'TERISI'
                            : table.status === 'kosong'
                              ? 'KOSONG'
                              : 'PERLU DIBERSIHKAN';

                        return (
                          <div
                            key={table.tableNumber}
                            className={`min-w-0 rounded-xl border p-3 text-center ${colorClass}`}
                          >
                            <p className="text-sm font-extrabold">
                              Meja {String(table.tableNumber).padStart(2, '0')}
                            </p>
                            <p className="mt-1 text-[10px] font-bold leading-tight">
                              {label}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </section>
            </section>
            )}

            {/* KELOLA PESANAN */}
                        {activeSection === 'pesanan-admin' && (
<section id="pesanan-admin" className={sectionClass}>
              <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-green-100 bg-gradient-to-r from-green-50 to-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div>
                  <h2 className="text-xl font-extrabold tracking-tight text-green-950">
                    Kelola Pesanan
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    Daftar pesanan dan rincian produk diperbarui langsung dari Firestore.
                  </p>
                </div>
                <span className="w-fit rounded-full border border-green-200 bg-white px-4 py-2 text-sm font-extrabold text-green-800 shadow-sm">
                  {orders.length} pesanan
                </span>
              </div>

              {orderError && (
                <p className="mt-3 break-words rounded-xl bg-red-50 p-3 text-sm text-red-700">
                  {orderError}
                </p>
              )}

              {orderMessage && (
                <p className="mt-3 break-words rounded-xl bg-green-50 p-3 text-sm font-semibold text-green-800">
                  {orderMessage}
                </p>
              )}

              <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 sm:p-4">
                <input
                  value={orderSearch}
                  onChange={(event) => setOrderSearch(event.target.value)}
                  placeholder="Cari kode, nama, atau nomor meja..."
                  className="min-w-0 rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-green-600"
                />

                <select
                  value={orderFilter}
                  onChange={(event) => setOrderFilter(event.target.value)}
                  className="min-w-0 rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-green-600"
                >
                  <option value="semua">Semua pesanan</option>
                  <option value="belum_lunas">Belum lunas</option>
                  <option value="lunas">Sudah lunas</option>
                  <option value="dibatalkan">Status dibatalkan</option>
                </select>
              </div>

              {filteredOrders.length === 0 ? (
                <div className="mt-4 rounded-xl bg-slate-50 p-5 text-center">
                  <p className="font-semibold text-slate-700">
                    {orders.length === 0
                      ? 'Belum ada pesanan.'
                      : 'Tidak ada pesanan yang cocok dengan pencarian.'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Pesanan baru akan muncul otomatis ketika tersimpan.
                  </p>
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  {filteredOrders.map((order) => (
                    <article
                      key={order.id}
                      className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
                    >
                      <div className="flex min-w-0 flex-col gap-3 border-b border-slate-100 bg-slate-50/80 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                        <div className="min-w-0">
                          <p className="break-words text-base font-extrabold tracking-tight text-slate-900">
                            {order.order_code || order.id}
                          </p>
                          <p className="mt-2 break-words text-sm font-semibold text-slate-700">
                            {order.customer_name || 'Nama pelanggan tidak tersedia'}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Meja {String(order.table_number).padStart(2, '0')}
                            {' · '}
                            {formatDate(order.created_at)}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass(order.status)}`}>
                            {statusLabel(order.status)}
                          </span>
                          <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                            order.payment_status === 'lunas'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {order.payment_status === 'lunas' ? 'LUNAS' : 'BELUM LUNAS'}
                          </span>
                        </div>
                      </div>

                      <div className="min-w-0 p-4 sm:p-5">
                        <h3 className="border-b border-slate-100 pb-2 text-sm font-extrabold text-green-900">
                          Rincian Pesanan
                        </h3>

                        {order.items.length === 0 ? (
                          <p className="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                            Rincian produk belum terbaca. Periksa data order_items.
                          </p>
                        ) : (
                          <div className="mt-3 space-y-3">
                            {order.items.map((item) => (
                              <div
                                key={item.id}
                                className="flex min-w-0 items-start justify-between gap-3 border-b border-slate-100 pb-3 text-sm last:border-0 last:pb-0"
                              >
                                <div className="min-w-0">
                                  <p className="break-words font-semibold text-slate-800">
                                    {item.item_name}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    {item.quantity} × {rupiah(item.item_price)}
                                  </p>
                                </div>
                                <p className="shrink-0 text-right font-semibold text-slate-800">
                                  {rupiah(item.subtotal)}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-green-100 bg-green-50 p-4">
                          <span className="text-sm font-bold text-green-900">
                            Total Pesanan
                          </span>
                          <span className="text-lg font-extrabold tabular-nums text-green-900">
                            {rupiah(order.total_amount)}
                          </span>
                        </div>

                        <div className="mt-5 grid min-w-0 grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 sm:p-4">
                          <div className="min-w-0">
                            <label className="mb-2 block text-xs font-extrabold text-slate-700">
                              Status Pesanan
                            </label>
                            <select
                              value={order.status}
                              disabled={processingOrderId === order.id}
                              onChange={(event) =>
                                updateOrderStatus(
                                  order,
                                  event.target.value as OrderStatus
                                )
                              }
                              className="w-full min-w-0 rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none transition-colors focus:border-green-600 focus:ring-2 focus:ring-green-100"
                            >
                              {orderStatusOptions.map((status) => (
                                <option key={status} value={status}>
                                  {statusLabel(status)}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="min-w-0">
                            <label className="mb-2 block text-xs font-extrabold text-slate-700">
                              Metode Pembayaran
                            </label>
                            {order.payment_status === 'lunas' ? (
                              <div className="rounded-xl border border-green-100 bg-green-50 p-3 text-sm font-bold text-green-800">
                                {order.payment_method === 'non_tunai'
                                  ? 'Non-Tunai'
                                  : order.payment_method === 'tunai'
                                    ? 'Tunai'
                                    : 'Sudah dibayar'}
                              </div>
                            ) : (
                              <select
                                value={paymentMethods[order.id] || 'tunai'}
                                onChange={(event) =>
                                  setPaymentMethods((current) => ({
                                    ...current,
                                    [order.id]: event.target.value
                                  }))
                                }
                                className="w-full min-w-0 rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none transition-colors focus:border-green-600 focus:ring-2 focus:ring-green-100"
                              >
                                <option value="tunai">Tunai</option>
                                <option value="non_tunai">Non-Tunai</option>
                              </select>
                            )}
                          </div>
                        </div>

                        {order.payment_status !== 'lunas' && (
                          <button
                            type="button"
                            disabled={
                              processingOrderId === order.id ||
                              order.status === 'dibatalkan'
                            }
                            onClick={() => recordOrderPayment(order)}
                            className={`${buttonClass} mt-4 w-full rounded-xl bg-green-800 py-3 font-bold text-white shadow-sm hover:bg-green-900`}
                          >
                            {processingOrderId === order.id
                              ? 'Memproses...'
                              : 'Catat Pembayaran / LUNAS'}
                          </button>
                        )}

                        {order.payment_status === 'lunas' && (
                          <p className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4 text-center text-sm font-bold text-green-800">
                            Pembayaran telah tercatat lunas.
                          </p>
                        )}
                      </div>

                      <div className="grid grid-cols-1 gap-3 border-t border-slate-100 bg-slate-50/70 p-4 sm:grid-cols-2 sm:p-5">
                        <button
                          type="button"
                          disabled={processingArchiveOrderId === order.id}
                          onClick={() => archiveOrder(order)}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-green-800 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {processingArchiveOrderId === order.id ? 'Memindahkan...' : 'Pindahkan ke Arsip'}
                        </button>
                        <button
                          type="button"
                          disabled={processingTrashOrderId === order.id || processingArchiveOrderId === order.id}
                          onClick={() => trashOrder(order)}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {processingTrashOrderId === order.id ? 'Memindahkan...' : 'Pindahkan ke Sampah'}
                        </button>
                      </div>
</article>
                  ))}
                </div>
              )}
            </section>
            )}

            {/* ARSIP PESANAN */}
            {activeSection === 'arsip-pesanan-admin' && (
              <section id="arsip-pesanan-admin" className={sectionClass}>
                <div className="mb-5">
                  <h2 className="text-xl font-extrabold text-green-900">
                    Arsip Pesanan
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    Riwayat pesanan yang dipindahkan ke arsip, dikelompokkan berdasarkan tahun dan bulan transaksi.
                  </p>
                </div>

                <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <h3 className="mb-3 text-base font-extrabold text-green-900">
                    Cari Arsip Pesanan
                  </h3>
                  <input
                    type="text"
                    value={archiveSearch}
                    onChange={(event) => setArchiveSearch(event.target.value)}
                    placeholder="Cari nama pelanggan, nomor pesanan, atau meja..."
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition-colors focus:border-green-600 focus:ring-2 focus:ring-green-100"
                  />

                  <div className="mt-4">
                    <h4 className="mb-2 text-sm font-bold text-slate-700">
                      Filter Tanggal Pesanan
                    </h4>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="block text-sm font-medium text-slate-600">
                        Dari tanggal
                        <input
                          type="date"
                          value={archiveDateFrom}
                          max={archiveDateTo || undefined}
                          onChange={(event) => setArchiveDateFrom(event.target.value)}
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"
                        />
                      </label>
                      <label className="block text-sm font-medium text-slate-600">
                        Sampai tanggal
                        <input
                          type="date"
                          value={archiveDateTo}
                          min={archiveDateFrom || undefined}
                          onChange={(event) => setArchiveDateTo(event.target.value)}
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"
                        />
                      </label>
                    </div>
                    {(archiveSearch || archiveDateFrom || archiveDateTo) && (
                      <button
                        type="button"
                        onClick={() => {
                          setArchiveSearch('');
                          setArchiveDateFrom('');
                          setArchiveDateTo('');
                        }}
                        className="mt-3 text-sm font-bold text-green-800 underline"
                      >
                        Reset pencarian dan filter
                      </button>
                    )}
                  </div>
                </div>

                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-extrabold text-green-900">
                    Kelompok Arsip
                  </h3>
                  <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-800">
                    {archivedOrders.length} Pesanan
                  </span>
                </div>

                {archivedOrders.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-7 text-center">
                    <p className="font-bold text-slate-700">
                      Belum ada pesanan di Arsip
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-slate-500">
                      Pesanan yang dipindahkan dari Manajemen Pesanan akan muncul di sini.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(archivedOrdersByYear)
                      .sort(([yearA], [yearB]) => Number(yearB) - Number(yearA))
                      .map(([year, months]) => (
                        <div key={year} className="overflow-hidden rounded-2xl border border-green-200 bg-white shadow-sm">
                          <div className="flex items-center justify-between gap-3 bg-green-50 p-4 sm:p-5">
                            <div>
                              <h4 className="font-extrabold text-green-950">
                                Tahun {year}
                              </h4>
                              <p className="mt-1 text-xs text-green-800">
                                {Object.values(months).reduce((total, list) => total + list.length, 0)} pesanan
                              </p>
                            </div>
                            <span className="rounded-full border border-green-200 bg-white px-3 py-1 text-xs font-bold text-green-800">
                              Tingkat 1
                            </span>
                          </div>

                          <div className="space-y-3 p-4 sm:p-5">
                            {Object.entries(months)
                              .sort(([monthA], [monthB]) => Number(monthB) - Number(monthA))
                              .map(([month, monthOrders]) => (
                                <div key={`${year}-${month}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
                                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                    <h5 className="font-extrabold text-slate-800">
                                      {new Intl.DateTimeFormat('id-ID', { month: 'long' }).format(new Date(Number(year), Number(month) - 1, 1))}
                                    </h5>
                                    <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200">
                                      {monthOrders.length} Pesanan
                                    </span>
                                  </div>

                                  <div className="space-y-3">
                                    {monthOrders
                                      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
                                      .map((order) => (
                                        <article key={order.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                                          <div className="p-4">
                                            <div className="flex flex-wrap items-start justify-between gap-3">
                                              <div className="min-w-0">
                                                <p className="break-all text-sm font-extrabold text-green-900">
                                                  {order.order_code || order.id}
                                                </p>
                                                <p className="mt-1 text-sm font-semibold text-slate-800">
                                                  {order.customer_name}
                                                </p>
                                                <p className="mt-1 text-xs text-slate-500">
                                                  {formatDate(order.created_at)} · Meja {String(order.table_number).padStart(2, '0')}
                                                </p>
                                              </div>
                                              <div className="text-right">
                                                <p className="text-xs text-slate-500">Total transaksi</p>
                                                <p className="mt-1 text-sm font-extrabold text-green-900">
                                                  {rupiah(order.total_amount)}
                                                </p>
                                                <span className={`mt-2 inline-block rounded-full px-2.5 py-1 text-xs font-bold ${order.payment_status === 'lunas' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
                                                  {order.payment_status === 'lunas' ? 'LUNAS' : 'BELUM LUNAS'}
                                                </span>
                                              </div>
                                            </div>

                                            <button
                                              type="button"
                                              onClick={() => setExpandedArchiveOrderId(
                                                expandedArchiveOrderId === order.id ? '' : order.id
                                              )}
                                              className="mt-4 w-full rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-sm font-bold text-green-800 hover:bg-green-100"
                                            >
                                              {expandedArchiveOrderId === order.id ? 'Tutup Detail' : 'Lihat Detail'}
                                            </button>
                                          </div>

                                          {expandedArchiveOrderId === order.id && (
                                            <div className="border-t border-slate-100 bg-slate-50 p-4">
                                              <h6 className="mb-3 text-sm font-extrabold text-slate-800">
                                                Rincian Pesanan
                                              </h6>
                                              {order.items.length === 0 ? (
                                                <p className="text-sm text-slate-500">
                                                  Rincian item tidak tersedia.
                                                </p>
                                              ) : (
                                                <div className="space-y-2">
                                                  {order.items.map((item) => (
                                                    <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg bg-white p-3">
                                                      <div className="min-w-0">
                                                        <p className="text-sm font-semibold text-slate-800">
                                                          {item.item_name}
                                                        </p>
                                                        <p className="mt-1 text-xs text-slate-500">
                                                          {item.quantity} × {rupiah(item.item_price)}
                                                        </p>
                                                      </div>
                                                      <p className="shrink-0 text-sm font-bold text-slate-800">
                                                        {rupiah(item.subtotal)}
                                                      </p>
                                                    </div>
                                                  ))}
                                                </div>
                                              )}
                                              <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-sm">
                                                <span className="font-bold text-slate-600">Total</span>
                                                <span className="font-extrabold text-green-900">
                                                  {rupiah(order.total_amount)}
                                                </span>
                                              </div>
                                              <p className="mt-2 text-xs text-slate-500">
                                                Status pesanan: {statusLabel(order.status)}
                                                {order.payment_method ? ` · Metode: ${order.payment_method === 'non_tunai' ? 'Non-Tunai' : 'Tunai'}` : ''}
                                              </p>
                                            </div>
                                          )}
                                        </article>
                                      ))}
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </section>
            )}

            {/* SAMPAH */}
            {activeSection === 'sampah-admin' && (
              <section id="sampah-admin" className={sectionClass}>
                <div className="mb-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-xl font-extrabold text-green-900">Sampah</h2>
                    <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold text-red-800">
                      {trashedOrders.length} Pesanan di Sampah
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    Kelola pesanan yang telah dipindahkan ke Sampah. Pesanan dapat dipulihkan atau dihapus secara permanen.
                  </p>
                </div>

                <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <h3 className="mb-3 text-base font-extrabold text-green-900">
                    Cari Pesanan di Sampah
                  </h3>
                  <input
                    type="text"
                    value={trashSearch}
                    onChange={(e) => setTrashSearch(e.target.value)}
                    placeholder="Cari nama pelanggan, nomor pesanan, atau nomor meja..."
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 placeholder:text-slate-400"
                  />
                  <div className="mt-4">
                    <h4 className="mb-2 text-sm font-bold text-slate-700">
                      Filter Tanggal Pesanan
                    </h4>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="block text-sm font-medium text-slate-600">
                        Dari tanggal
                        <input
                          type="date"
                          value={trashDateFrom}
                          onChange={(e) => setTrashDateFrom(e.target.value)}
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm"
                        />
                      </label>
                      <label className="block text-sm font-medium text-slate-600">
                        Sampai tanggal
                        <input
                          type="date"
                          value={trashDateTo}
                          onChange={(e) => setTrashDateTo(e.target.value)}
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm"
                        />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-extrabold text-green-900">
                    Daftar Pesanan di Sampah
                  </h3>
                  <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-800">
                    Area Pengelolaan
                  </span>
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 bg-slate-50 p-4 sm:p-5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-800">
                        <span className="text-lg font-extrabold">S</span>
                      </div>
                      <div>
                        <h4 className="font-extrabold text-slate-800">Daftar Transaksi</h4>
                        <p className="text-xs text-slate-500">
                          Pesanan yang dipindahkan ke Sampah akan ditampilkan di sini.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 sm:p-5">
                    {trashedOrders.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
                        <p className="font-semibold text-slate-700">
                          {trashSearch || trashDateFrom || trashDateTo
                            ? 'Pesanan tidak ditemukan'
                            : 'Belum ada pesanan di Sampah'}
                        </p>
                        <p className="mt-1 text-sm leading-relaxed text-slate-500">
                          {trashSearch || trashDateFrom || trashDateTo
                            ? 'Coba ubah kata pencarian atau rentang tanggal.'
                            : 'Pesanan yang dipindahkan ke Sampah akan ditampilkan di sini.'}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {trashedOrders
                          .slice()
                          .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
                          .map((order) => (
                            <article key={order.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                              <div className="p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="break-all text-sm font-extrabold text-red-800">
                                      {order.order_code || order.id}
                                    </p>
                                    <p className="mt-1 text-sm font-semibold text-slate-800">
                                      {order.customer_name}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {formatDate(order.created_at)} · Meja {String(order.table_number).padStart(2, '0')}
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-xs text-slate-500">Total transaksi</p>
                                    <p className="mt-1 text-sm font-extrabold text-green-900">
                                      {rupiah(order.total_amount)}
                                    </p>
                                    <span className={`mt-2 inline-block rounded-full px-2.5 py-1 text-xs font-bold ${order.payment_status === 'lunas' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
                                      {order.payment_status === 'lunas' ? 'LUNAS' : 'BELUM LUNAS'}
                                    </span>
                                  </div>
                                </div>

                                <div className="mt-4 border-t border-slate-100 pt-3">
                                  <p className="mb-2 text-xs font-extrabold text-slate-600">
                                    Rincian Pesanan
                                  </p>
                                  {order.items.length === 0 ? (
                                    <p className="text-sm text-slate-500">Rincian item tidak tersedia.</p>
                                  ) : (
                                    <div className="space-y-2">
                                      {order.items.map((item) => (
                                        <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 p-3">
                                          <div className="min-w-0">
                                            <p className="text-sm font-semibold text-slate-800">{item.item_name}</p>
                                            <p className="mt-1 text-xs text-slate-500">
                                              {item.quantity} × {rupiah(item.item_price)}
                                            </p>
                                          </div>
                                          <p className="shrink-0 text-sm font-bold text-slate-800">
                                            {rupiah(item.subtotal)}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <p className="mt-3 text-xs text-slate-500">
                                  Status pesanan: {statusLabel(order.status)}
                                  {order.payment_method ? ` · Metode: ${order.payment_method === 'non_tunai' ? 'Non-Tunai' : 'Tunai'}` : ''}
                                </p>
                                <button
                                  type="button"
                                  disabled={processingRestoreOrderId !== '' || processingDeleteOrderId !== ''}
                                  onClick={() => setSelectedTrashOrderId(
                                    selectedTrashOrderId === order.id ? '' : order.id
                                  )}
                                  className={`mt-4 w-full rounded-xl border px-4 py-2.5 text-sm font-bold ${selectedTrashOrderId === order.id ? 'border-red-300 bg-red-50 text-red-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'} disabled:cursor-not-allowed disabled:opacity-60`}
                                >
                                  {selectedTrashOrderId === order.id ? 'Pesanan Dipilih · Batalkan Pilihan' : 'Pilih Pesanan'}
                                </button>
                              </div>
                            </article>
                          ))}
                      </div>
                    )}

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        disabled={!selectedTrashOrderId || processingRestoreOrderId !== ''}
                        onClick={() => {
                          const selectedOrder = trashedOrders.find(
                            (order) => order.id === selectedTrashOrderId
                          );
                          if (selectedOrder) void restoreOrder(selectedOrder);
                        }}
                        className="flex w-full items-center justify-center rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-green-800 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {processingRestoreOrderId ? 'Memulihkan...' : 'Pulihkan'}
                      </button>
                      <button
                        type="button"
                        disabled={!selectedTrashOrderId || processingRestoreOrderId !== '' || processingDeleteOrderId !== ''}
                        onClick={() => {
                          const selectedOrder = trashedOrders.find(
                            (order) => order.id === selectedTrashOrderId
                          );
                          if (selectedOrder) void permanentlyDeleteOrder(selectedOrder);
                        }}
                        className="flex w-full items-center justify-center rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {processingDeleteOrderId ? 'Menghapus...' : 'Hapus Permanen'}
                      </button>
                    </div>
                    <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                      Penghapusan permanen tidak dapat dibatalkan. Pastikan pesanan yang dipilih sudah benar sebelum mengonfirmasi.
                    </p>
                  </div>
                </div>
              </section>
            )}

            {/* PENGATURAN QR */}
                        {activeSection === 'meja-admin' && (
<section id="qr-admin" className={sectionClass}>
              <div className="mb-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="break-words text-lg font-extrabold text-green-900">
                    Pengelola QR Meja
                  </h2>
                  <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-800">
                    50 Meja
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Kelola, pulihkan, dan cetak QR unik untuk Meja 01 sampai Meja 50.
                  QR yang sudah tersedia tetap dipertahankan.
                </p>
              </div>

              <button
                type="button"
                onClick={generateTableQrs}
                disabled={qrLoading}
                className={`${buttonClass} mt-4 py-4 bg-green-800 text-white shadow-sm hover:bg-green-900`}
              >
                {qrLoading ? 'Memproses 50 QR...' : 'Buat / Pulihkan 50 QR'}
              </button>

              {qrMessage && (
                <p className="mt-3 break-words rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-900">
                  {qrMessage}
                </p>
              )}

              {qrItems.length === 50 && (
                <>
                  <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm leading-relaxed text-green-900 shadow-sm">
                    <p className="font-bold">
                      50 QR berhasil disiapkan.
                    </p>
                    <p>
                      Token QR disimpan terenkripsi di server. Pratinjau QR
                      ditampilkan selama halaman Admin terbuka.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={printTableQrs}
                    className={`${buttonClass} mt-4 w-full py-4 bg-blue-700 text-white shadow-sm hover:bg-blue-800`}
                  >
                    Cetak 50 QR Meja
                  </button>

                  <div className="mt-5 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 xl:grid-cols-5">
                    {qrItems.map((item) => (
                      <div
                        key={item.tableNumber}
                        className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm transition-shadow hover:shadow-md sm:p-4"
                      >
                        <p className="break-words text-sm font-extrabold text-green-900">
                          {item.tableName}
                        </p>
                        <img
                          src={item.imageUrl}
                          alt={`QR ${item.tableName}`}
                          className="mx-auto mt-2 block w-full max-w-full"
                        />
                        <p className="mt-2 break-words text-xs text-slate-500">
                          Scan untuk memesan
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
            )}

            {/* PENGATURAN MEJA */}
                        {activeSection === 'meja-admin' && (
<section id="meja-admin" className={sectionClass}>
              <div className="mb-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="break-words text-lg font-extrabold text-green-900">
                    Pengelola 50 Meja
                  </h2>
                  <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-800">
                    01–50
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Siapkan data 50 meja dan periksa kondisi serta rekomendasi status meja.
                  Pengubahan status operasional tetap dilakukan melalui Panel Meja Kasir.
                </p>
              </div>

              <button
                type="button"
                onClick={seedRestaurantTables}
                disabled={seedingTables}
                className={`${buttonClass} mt-3 w-full py-4 bg-green-800 text-white shadow-sm hover:bg-green-900`}
              >
                {seedingTables ? 'Menyiapkan Meja...' : 'Siapkan 50 Meja'}
              </button>

              {seedMessage && (
                <p className="mt-3 break-words rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-900">
                  {seedMessage}
                </p>
              )}

              <button
                type="button"
                onClick={previewTableMigration}
                disabled={previewLoading}
                className={`${buttonClass} mt-3 w-full border border-blue-200 bg-blue-50 py-3 text-blue-900 shadow-sm hover:bg-blue-100`}
              >
                {previewLoading ? 'Membaca Status 50 Meja...' : 'Preview Status 50 Meja'}
              </button>

              {previewError && (
                <p className="mt-3 break-words rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">
                  {previewError}
                </p>
              )}

              {previewResult && (
                <div className="mt-4 space-y-4">
                  <p className="rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-900">
                    {previewResult.message}
                  </p>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {[
                      ['Total Meja', previewResult.summary.total_tables],
                      ['Dokumen Tersedia', previewResult.summary.existing_documents],
                      ['Dokumen Belum Ada', previewResult.summary.missing_documents],
                      ['Status Belum Diatur', previewResult.summary.missing_status],
                      ['Rekomendasi Terisi', previewResult.summary.occupied_recommendations],
                      ['Rekomendasi Dibersihkan', previewResult.summary.cleaning_recommendations],
                      ['Pesanan Aktif', previewResult.summary.active_orders_total],
                      ['Konflik Sesi', previewResult.summary.session_conflicts],
                      ['Status Tidak Cocok', previewResult.summary.status_mismatches],
                      ['Meja Nonaktif', previewResult.summary.inactive_tables]
                    ].map(([label, value]) => (
                      <div key={label} className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                        <p className="break-words text-xs font-medium leading-relaxed text-slate-500">{label}</p>
                        <p className="mt-2 text-2xl font-extrabold tabular-nums text-slate-900">{value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <h3 className="border-b border-slate-200 pb-2 text-base font-extrabold text-green-900">Rincian Rekomendasi 50 Meja</h3>

                    {previewResult.tables.map((table) => (
                      <article
                        key={table.table_number}
                        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className="font-bold text-slate-900">
                            Meja {String(table.table_number).padStart(2, '0')}
                          </h4>
                          <span className="text-xs text-slate-500">
                            {table.document_exists ? 'Dokumen tersedia' : 'Dokumen belum ada'}
                          </span>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                          <p className="text-slate-600">
                            Status sekarang: <strong>{table.current_status || 'Belum diatur'}</strong>
                          </p>
                          <p className="text-slate-600">
                            Rekomendasi: <strong>{table.recommended_status}</strong>
                          </p>
                          <p className="text-slate-600">
                            Pesanan aktif: <strong>{table.active_order_count}</strong>
                          </p>
                          <p className="text-slate-600">
                            Meja aktif: <strong>{table.is_active === null ? 'Belum diketahui' : table.is_active ? 'Ya' : 'Tidak'}</strong>
                          </p>
                        </div>

                        {table.active_orders.length > 0 && (
                          <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                            {table.active_orders.map((order, index) => (
                              <p key={`${order.order_id}-${index}`} className="break-words text-xs text-slate-600">
                                {order.order_code || order.order_id} · {order.status || '-'} · Pembayaran: {order.payment_status || '-'}
                              </p>
                            ))}
                          </div>
                        )}

                        {(table.session_conflict || table.status_mismatch) && (
                          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-relaxed text-amber-900">
                            {[
                              table.session_conflict ? 'Terdapat konflik sesi meja.' : '',
                              table.status_mismatch ? 'Status sekarang tidak cocok dengan pesanan aktif.' : ''
                            ].filter(Boolean).join(' ')}
                          </p>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </section>
            )}

            {/* BANNER PROMOSI */}
                        {activeSection === 'menu-admin' && (
<section id="banner-admin" className={sectionClass}>
              <h2 className="break-words text-lg font-bold text-green-900">
                Pengelolaan Banner Promosi
              </h2>

              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                Tambahkan promosi yang akan ditampilkan pada halaman pelanggan.
                Banner dapat diaktifkan atau dinonaktifkan kapan saja.
              </p>

              <div className="mt-4 min-w-0 rounded-xl border border-slate-200 p-3 sm:p-4">
                <h3 className="mb-3 break-words font-bold text-slate-800">
                  {editingBanner ? 'Edit Banner' : 'Tambah Banner Baru'}
                </h3>

                <label className="mb-2 block text-sm font-semibold">
                  Judul Banner *
                </label>
                <input
                  value={bannerTitle}
                  onChange={(e) => setBannerTitle(e.target.value)}
                  maxLength={100}
                  placeholder="Contoh: Promo Hemat Hari Ini"
                  className={inputClass}
                />

                <label className="mb-2 block text-sm font-semibold">
                  Deskripsi Banner
                </label>
                <textarea
                  value={bannerDescription}
                  onChange={(e) => setBannerDescription(e.target.value)}
                  maxLength={300}
                  placeholder="Tuliskan informasi promosi..."
                  className={inputClass}
                  rows={3}
                />

                <div className="mb-3 min-w-0 rounded-xl border border-dashed border-slate-300 p-3 sm:p-4">
                  <label className="mb-2 block font-bold">
                    Foto Banner *
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleBannerPhotoChange}
                    className="block w-full min-w-0 max-w-full text-sm"
                  />

                  {(bannerPreviewUrl || bannerExistingImageUrl) && (
                    <div className="mt-3 min-w-0">
                      <p className="mb-2 text-sm text-slate-500">
                        Pratinjau banner:
                      </p>
                      <img
                        src={bannerPreviewUrl || bannerExistingImageUrl}
                        alt="Pratinjau banner"
                        className="max-h-56 w-full max-w-full rounded-xl object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setBannerFile(null);
                          setBannerExistingImageUrl('');
                        }}
                        className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700"
                      >
                        Hapus Foto
                      </button>
                    </div>
                  )}
                </div>

                <label className="flex min-w-0 items-start gap-3 rounded-xl bg-green-50 p-3">
                  <input
                    type="checkbox"
                    checked={bannerActive}
                    onChange={(e) => setBannerActive(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-green-800"
                  />
                  <span className="min-w-0 break-words text-sm font-semibold text-green-900">
                    Aktifkan banner setelah disimpan
                  </span>
                </label>

                {bannerError && (
                  <p className="mt-3 break-words rounded-lg bg-red-100 p-3 text-sm text-red-800">
                    {bannerError}
                  </p>
                )}

                <button
                  type="button"
                  onClick={saveBanner}
                  disabled={bannerSaving}
                  className={`${buttonClass} mt-4 bg-green-800 text-white hover:bg-green-900`}
                >
                  {bannerSaving
                    ? 'Menyimpan Banner...'
                    : editingBanner
                      ? 'Simpan Perubahan Banner'
                      : 'Simpan Banner'}
                </button>

                {editingBanner && (
                  <button
                    type="button"
                    onClick={cancelBannerEdit}
                    className={`${buttonClass} mt-2 bg-slate-200 text-slate-700`}
                  >
                    Batal Edit Banner
                  </button>
                )}
              </div>

              <div className="mt-5 min-w-0">
                <h3 className="mb-3 break-words font-bold text-slate-800">
                  Daftar Banner ({banners.length})
                </h3>

                {banners.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                    Belum ada banner promosi.
                  </p>
                ) : (
                  <div className="min-w-0 space-y-4">
                    {banners.map((banner) => (
                      <article
                        key={banner.id}
                        className="min-w-0 overflow-hidden rounded-xl border border-slate-200"
                      >
                        {banner.image_url && (
                          <img
                            src={banner.image_url}
                            alt={banner.title}
                            className="max-h-52 w-full max-w-full object-cover"
                          />
                        )}

                        <div className="min-w-0 p-3 sm:p-4">
                          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                            <h4 className="min-w-0 break-words font-bold text-slate-900">
                              {banner.title}
                            </h4>
                            <span
                              className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
                                banner.is_active
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-slate-200 text-slate-600'
                              }`}
                            >
                              {banner.is_active ? 'Aktif' : 'Nonaktif'}
                            </span>
                          </div>

                          {banner.description && (
                            <p className="mt-2 break-words text-sm text-slate-600">
                              {banner.description}
                            </p>
                          )}

                          <div className="mt-4 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
                            <button
                              type="button"
                              onClick={() => startEditBanner(banner)}
                              className="min-w-0 rounded-lg bg-blue-100 px-3 py-2 text-sm font-semibold text-blue-800"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleBannerStatus(banner)}
                              className="min-w-0 rounded-lg bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-800"
                            >
                              {banner.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeBanner(banner)}
                              className="min-w-0 rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-700"
                            >
                              Hapus
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
            )}

            {/* LAPORAN */}
                        {activeSection === 'laporan-admin' && (
  <section id="laporan-admin" className={sectionClass}>
    <div className="mb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-green-900">
            Laporan Penjualan
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Ringkasan dan rekapitulasi transaksi WAROENG BPJS.
          </p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-green-100 bg-green-50 px-3 py-1.5 text-xs font-bold text-green-800">
            Laporan Admin
          </span>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-xl bg-green-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-green-800"
          >
            Cetak Laporan
          </button>
        </div>
      </div>
    </div>

    <div className="print-only-report mb-5">
      <h1 className="text-xl font-extrabold">WAROENG BPJS</h1>
      <h2 className="text-base font-bold">LAPORAN PENJUALAN</h2>
      <p className="mt-1 text-sm">
        Periode: {reportStart || 'Semua tanggal'} sampai {reportEnd || 'Terbaru'}
      </p>
    </div>

    <div className="report-period-filter rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4">
        <h3 className="font-bold text-slate-900">Periode Laporan</h3>
        <p className="mt-1 text-xs text-slate-500">
          Tentukan tanggal untuk melihat laporan penjualan.
        </p>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label className="mb-2 block text-xs font-bold text-slate-600">
            Dari tanggal
          </label>
          <input
            type="date"
            value={reportStart}
            onChange={(event) => setReportStart(event.target.value)}
            className="w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none transition focus:border-green-500 focus:bg-white focus:ring-2 focus:ring-green-100"
          />
        </div>

        <div className="min-w-0">
          <label className="mb-2 block text-xs font-bold text-slate-600">
            Sampai tanggal
          </label>
          <input
            type="date"
            value={reportEnd}
            min={reportStart || undefined}
            onChange={(event) => setReportEnd(event.target.value)}
            className="w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none transition focus:border-green-500 focus:bg-white focus:ring-2 focus:ring-green-100"
          />
        </div>
      </div>

      {reportStart && reportEnd && reportStart > reportEnd && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
          Tanggal awal tidak boleh melewati tanggal akhir.
        </p>
      )}
    </div>

    <div className="mt-5">
      <div className="mb-3">
        <h3 className="font-bold text-slate-900">Ringkasan Penjualan</h3>
        <p className="mt-1 text-xs text-slate-500">
          Ikhtisar transaksi pada periode yang dipilih.
        </p>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <article className="min-w-0 rounded-2xl border border-green-200 bg-green-50 p-4">
          <p className="text-xs font-bold text-green-800">
            OMZET PEMBAYARAN LUNAS
          </p>
          <p className="mt-2 break-words text-xl font-extrabold text-green-900">
            {rupiah(paidRevenue)}
          </p>
          <p className="mt-1 text-xs text-green-700">
            Total pembayaran yang sudah diterima
          </p>
        </article>

        <article className="min-w-0 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-bold text-amber-800">
            TOTAL BELUM LUNAS
          </p>
          <p className="mt-2 break-words text-xl font-extrabold text-amber-900">
            {rupiah(unpaidTotal)}
          </p>
          <p className="mt-1 text-xs text-amber-700">
            Nilai pesanan yang belum dibayar
          </p>
        </article>

        <article className="min-w-0 rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <p className="text-xs font-bold text-blue-800">
            JUMLAH PESANAN
          </p>
          <p className="mt-2 text-2xl font-extrabold text-blue-900">
            {reportStart && reportEnd && reportStart > reportEnd
              ? 0
              : reportOrders.length}
          </p>
          <p className="mt-1 text-xs text-blue-700">
            Total transaksi pada periode
          </p>
        </article>

        <article className="min-w-0 rounded-2xl border border-purple-200 bg-purple-50 p-4">
          <p className="text-xs font-bold text-purple-800">
            PESANAN SELESAI
          </p>
          <p className="mt-2 text-2xl font-extrabold text-purple-900">
            {reportStart && reportEnd && reportStart > reportEnd
              ? 0
              : completedOrders}
          </p>
          <p className="mt-1 text-xs text-purple-700">
            Jumlah pesanan berstatus selesai
          </p>
        </article>
      </div>
    </div>

    <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-5">
        <h3 className="font-bold text-slate-900">Grafik Omzet Harian</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Pergerakan omzet dari pembayaran lunas berdasarkan tanggal terpilih.
        </p>
      </div>

      {reportStart && reportEnd && reportStart > reportEnd ? (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Pilih rentang tanggal yang valid untuk melihat grafik.
        </p>
      ) : dailyRevenueEntries.length === 0 ? (
        <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">
          Belum ada transaksi lunas pada rentang tanggal ini.
        </p>
      ) : (
        <div className="overflow-x-auto pb-3">
          <div className="flex min-w-max items-end gap-3">
            {dailyRevenueEntries.map(([date, amount]) => (
              <div
                key={date}
                className="flex w-12 flex-col items-center gap-2"
                title={`${date}: ${rupiah(amount)}`}
              >
                <div className="flex h-36 w-full items-end justify-center rounded-t-lg bg-slate-50">
                  <div
                    className="w-7 rounded-t-lg bg-green-600 transition-all"
                    style={{
                      height: `${Math.max(3, (amount / maxDailyRevenue) * 100)}%`
                    }}
                  />
                </div>
                <span className="text-xs font-semibold text-slate-600">
                  {date.slice(8, 10)}/{date.slice(5, 7)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-2 border-t border-slate-100 pt-3 text-xs text-slate-400">
        Sentuh atau tahan batang grafik untuk melihat nilai omzet harian.
      </p>
    </div>

    <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50 p-4">
        <h3 className="font-bold text-slate-900">Rincian Pembayaran</h3>
        <p className="mt-1 text-xs text-slate-500">
          Ringkasan status pembayaran transaksi.
        </p>
      </div>

      <div className="divide-y divide-slate-100 px-4">
        <div className="flex items-center justify-between gap-3 py-4">
          <span className="text-sm text-slate-600">Pesanan lunas</span>
          <strong className="rounded-lg bg-green-50 px-3 py-1.5 text-sm text-green-800">
            {paidOrders.length}
          </strong>
        </div>

        <div className="flex items-center justify-between gap-3 py-4">
          <span className="text-sm text-slate-600">Pesanan belum lunas</span>
          <strong className="rounded-lg bg-amber-50 px-3 py-1.5 text-sm text-amber-800">
            {unpaidOrders.length}
          </strong>
        </div>

        <div className="flex items-center justify-between gap-3 py-4">
          <span className="text-sm text-slate-600">Pesanan dibatalkan</span>
          <strong className="rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-800">
            {reportOrders.filter((order) => order.status === 'dibatalkan').length}
          </strong>
        </div>
      </div>
    </div>

    <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
      <p className="text-xs font-bold text-blue-900">Catatan Laporan</p>
      <p className="mt-1 text-xs leading-relaxed text-blue-800">
        Omzet dihitung dari pesanan berstatus lunas. Pesanan yang belum lunas
        tidak dimasukkan ke omzet.
      </p>
    </div>
  </section>
)}

            {/* AKUN KASIR */}
{activeSection === 'akun-admin' && (
              <section id="akun-admin" className={sectionClass}>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-green-900">
                      Manajemen Kasir
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Pantau akun staf dan kasir WAROENG BPJS.
                    </p>
                  </div>
                  <span className="w-fit rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800">
                    {staffProfiles.length} akun terdaftar
                  </span>
                </div>

                {/* STATUS KASIR */}
                <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                  <h3 className="font-bold text-slate-900">Kasir yang Bertugas</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Status kehadiran kasir akan ditampilkan di bagian ini.
                  </p>

                  <div className="mt-3 flex flex-wrap gap-4 text-xs font-medium">
                    <span className="inline-flex items-center gap-2 text-green-700">
                      <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
                      Online
                    </span>
                    <span className="inline-flex items-center gap-2 text-slate-500">
                      <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
                      Offline
                    </span>
                  </div>

                  <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center">
                    <p className="text-sm font-semibold text-slate-700">
                      Pemantauan online belum diaktifkan
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Nama kasir dan indikator status akan muncul setelah fitur kehadiran diaktifkan.
                    </p>
                  </div>
                </div>

                {/* DAFTAR AKUN */}
                <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-slate-900">
                        Daftar Akun Staf dan Kasir
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Data dibaca dari koleksi staff_profiles.
                      </p>
                    </div>
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                      {staffProfiles.length} akun
                    </span>
                  </div>

                  {staffError && (
                    <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                      {staffError}
                    </p>
                  )}

                  {cashierAccountsError && (
                    <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                      {cashierAccountsError}
                    </p>
                  )}

                  {staffProfiles.length === 0 ? (
                    <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                      Belum ada data akun yang dapat ditampilkan.
                    </p>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {staffProfiles.map((staff) => {
                        const role = staff.role.trim().toLowerCase();
                        const isCashier = role === 'kasir';
                        const cashierAccount = isCashier
                          ? cashierAccounts.find((account) => account.uid === staff.id)
                          : undefined;

                        return (
                          <article
                            key={staff.id}
                            className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0">
                              <p className="break-words font-bold text-slate-900">
                                {staff.full_name || 'Nama belum diatur'}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {staff.created_at
                                  ? `Terdaftar: ${formatDate(staff.created_at)}`
                                  : 'Tanggal pendaftaran tidak tersedia'}
                              </p>
                              {isCashier && (
                                <div className="mt-2 space-y-1 text-xs">
                                  <p className="break-all text-slate-600">
                                    Email: {cashierAccount?.email || (cashierAccountsLoading ? 'Memuat...' : 'Tidak tersedia')}
                                  </p>
                                  {cashierAccount && (
                                    <p className={cashierAccount.disabled ? 'font-semibold text-red-600' : 'font-semibold text-green-600'}>
                                      Status akun: {cashierAccount.disabled ? 'Nonaktif' : 'Aktif'}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                            <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${
                              isCashier
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-green-100 text-green-800'
                            }`}>
                              {staff.role || 'Role belum diatur'}
                            </span>
                            {isCashier && cashierAccount && (
                              <button
                                type="button"
                                onClick={() => handleSelectCashier(cashierAccount)}
                                className={`w-full rounded-lg px-3 py-2 text-xs font-bold sm:w-auto ${
                                  selectedCashierId === cashierAccount.uid
                                    ? 'bg-green-700 text-white'
                                    : 'border border-green-700 text-green-800 hover:bg-green-50'
                                }`}
                              >
                                {selectedCashierId === cashierAccount.uid
                                  ? 'Akun Dipilih'
                                  : 'Pilih untuk Dikelola'}
                              </button>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* FORM TAMBAH AKUN */}
                <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                  <h3 className="font-bold text-slate-900">Tambah Akun Kasir</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Buat akun kasir baru untuk mengakses halaman Kasir.
                  </p>

                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block text-xs font-semibold text-slate-600">
                      Nama lengkap
                      <input
                        value={cashierName}
                        onChange={(event) => setCashierName(event.target.value)}
                        placeholder="Masukkan nama kasir"
                        autoComplete="off"
                        required
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm"
                      />
                    </label>

                    <label className="block text-xs font-semibold text-slate-600">
                      Email akun
                      <input
                        value={cashierEmail}
                        onChange={(event) => setCashierEmail(event.target.value)}
                        type="email"
                        placeholder="nama@email.com"
                        autoComplete="off"
                        required
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm"
                      />
                    </label>

                    <label className="block text-xs font-semibold text-slate-600 sm:col-span-2">
                      Kata sandi awal
                      <div className="mt-1 flex gap-2">
                        <input
                          value={cashierPassword}
                          onChange={(event) => setCashierPassword(event.target.value)}
                          type={showCashierPassword ? 'text' : 'password'}
                          placeholder="Buat kata sandi awal (minimal 8 karakter)"
                          autoComplete="new-password"
                          required
                          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-3 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCashierPassword((value) => !value)}
                          className="rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700"
                        >
                          {showCashierPassword ? 'Sembunyikan Sandi' : 'Tampilkan Sandi'}
                        </button>
                      </div>
                    </label>
                  </div>

                  {cashierCreateError && (
                    <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                      {cashierCreateError}
                    </p>
                  )}

                  {cashierCreateMessage && (
                    <p className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-700">
                      {cashierCreateMessage}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={handleCreateCashier}
                    disabled={creatingCashier}
                    className="mt-4 w-full rounded-xl bg-green-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                  >
                    {creatingCashier ? 'Menyimpan...' : 'Tambahkan Akun Kasir'}
                  </button>
                </div>

                {/* PENGELOLAAN AKUN */}
                <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                  <h3 className="font-bold text-slate-900">Pengelolaan Akun Kasir</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Pilih akun kasir dari daftar untuk mengubah data atau statusnya. Akun Admin tidak dapat dikelola dari bagian ini.
                  </p>

                  {cashierAccountsLoading && (
                    <p className="mt-3 text-sm text-slate-500">Memuat akun kasir...</p>
                  )}

                  {!cashierAccountsLoading && cashierAccounts.length === 0 && (
                    <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                      Belum ada akun kasir yang dapat dikelola. Pastikan daftar akun berhasil dimuat.
                    </p>
                  )}

                  {selectedCashierId && (() => {
                    const selectedAccount = cashierAccounts.find(
                      (item) => item.uid === selectedCashierId
                    );
                    const selectedProfile = staffProfiles.find(
                      (item) => item.id === selectedCashierId
                    );

                    if (
                      !selectedAccount ||
                      !selectedProfile ||
                      selectedProfile.role.trim().toLowerCase() !== 'kasir'
                    ) {
                      return (
                        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                          Akun yang dipilih tidak tersedia atau bukan akun kasir.
                        </p>
                      );
                    }

                    return (
                      <div className="mt-4 space-y-4">
                        <div className="rounded-xl bg-green-50 p-3">
                          <p className="text-xs font-semibold text-green-800">Akun yang dipilih</p>
                          <p className="mt-1 font-bold text-green-950">{selectedAccount.full_name}</p>
                          <p className="break-all text-xs text-green-800">{selectedAccount.email}</p>
                          <p className={`mt-1 text-xs font-bold ${
                            selectedAccount.disabled ? 'text-red-700' : 'text-green-700'
                          }`}>
                            Status: {selectedAccount.disabled ? 'Nonaktif' : 'Aktif'}
                          </p>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <label className="block text-xs font-semibold text-slate-600">
                            Nama lengkap
                            <input
                              value={editingCashierName}
                              onChange={(event) => setEditingCashierName(event.target.value)}
                              maxLength={80}
                              className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm"
                            />
                          </label>

                          <label className="block text-xs font-semibold text-slate-600">
                            Email akun
                            <input
                              type="email"
                              value={editingCashierEmail}
                              onChange={(event) => setEditingCashierEmail(event.target.value)}
                              className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm"
                            />
                          </label>

                          <label className="block text-xs font-semibold text-slate-600 sm:col-span-2">
                            Kata sandi baru
                            <div className="mt-1 flex gap-2">
                              <input
                                type={showEditingCashierPassword ? 'text' : 'password'}
                                value={editingCashierPassword}
                                onChange={(event) => setEditingCashierPassword(event.target.value)}
                                placeholder="Kosongkan jika tidak ingin mengganti"
                                autoComplete="new-password"
                                className="min-w-0 flex-1 rounded-xl border border-slate-200 p-3 text-sm"
                              />
                              <button
                                type="button"
                                onClick={() => setShowEditingCashierPassword((value) => !value)}
                                className="rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700"
                              >
                                {showEditingCashierPassword ? 'Sembunyikan' : 'Tampilkan'}
                              </button>
                            </div>
                          </label>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={handleUpdateCashier}
                            disabled={savingCashierEdit}
                            className="rounded-xl bg-green-700 px-4 py-3 text-xs font-bold text-white disabled:opacity-50"
                          >
                            {savingCashierEdit ? 'Menyimpan...' : 'Simpan Perubahan'}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleToggleCashierStatus(selectedAccount)}
                            disabled={processingCashierStatusId === selectedAccount.uid}
                            className={`rounded-xl px-4 py-3 text-xs font-bold text-white disabled:opacity-50 ${
                              selectedAccount.disabled ? 'bg-green-700' : 'bg-red-600'
                            }`}
                          >
                            {processingCashierStatusId === selectedAccount.uid
                              ? 'Memproses...'
                              : selectedAccount.disabled
                                ? 'Aktifkan Kembali'
                                : 'Nonaktifkan Akun'}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCashierId('');
                              setEditingCashierName('');
                              setEditingCashierEmail('');
                              setEditingCashierPassword('');
                              setCashierManagementMessage('');
                              setCashierManagementError('');
                            }}
                            className="rounded-xl border border-slate-200 px-4 py-3 text-xs font-bold text-slate-600"
                          >
                            Batal
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                  {cashierManagementError && (
                    <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                      {cashierManagementError}
                    </p>
                  )}

                  {cashierManagementMessage && (
                    <p className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-700">
                      {cashierManagementMessage}
                    </p>
                  )}
                </div>
              </section>
            )}


            {/* PENGATURAN */}
            {activeSection === 'pengaturan-admin' && (
              <section id="pengaturan-admin" className={sectionClass}>
                <div className="mb-5">
                  <h2 className="text-lg font-extrabold text-green-900">
                    Pengaturan Restoran
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    Informasi identitas dan operasional WAROENG BPJS.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-green-100 bg-white p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Identitas Restoran
                    </p>
                    <p className="mt-2 text-xl font-extrabold text-green-900">
                      WAROENG BPJS
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Nama usaha</p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Alamat Restoran
                    </p>
                    <p className="mt-2 break-words text-sm font-semibold leading-relaxed text-slate-900">
                      Jl. Kandang Sapi 001/002 No. 01 Desa Tanjungsari,
                      Kecamatan Sukaluyu Kabupaten Cianjur
                    </p>
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Kapasitas Meja
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-2xl border border-green-100 bg-white p-4 shadow-sm">
                        <p className="text-3xl font-extrabold text-green-800">50</p>
                        <p className="mt-1 text-xs font-medium text-slate-500">
                          Total meja
                        </p>
                      </div>
                      <div className="rounded-2xl border border-green-100 bg-white p-4 shadow-sm">
                        <p className="text-2xl font-extrabold text-green-800">01–50</p>
                        <p className="mt-1 text-xs font-medium text-slate-500">
                          Nomor meja
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Sistem Pembayaran
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full bg-green-50 px-3 py-1.5 text-xs font-bold text-green-800">
                        Tunai
                      </span>
                      <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-800">
                        Non-Tunai
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      Pembayaran dicatat oleh petugas.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
                    <p className="text-sm font-bold text-blue-900">
                      Informasi Pengaturan
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-blue-800">
                      Halaman ini masih menampilkan informasi operasional.
                      Penyimpanan pengaturan belum diaktifkan karena struktur
                      koleksi pengaturan restoran belum tersedia.
                    </p>
                  </div>
                </div>
              </section>
            )}

            {/* RINGKASAN MANAJEMEN MENU */}
            {activeSection === 'menu-admin' && (
              <section className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <article className="rounded-2xl border border-green-100 bg-white p-4 shadow-sm">
                  <p className="text-sm font-semibold text-slate-500">Total Produk</p>
                  <p className="mt-2 text-3xl font-extrabold text-green-900">
                    {menus.length}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Seluruh menu terdaftar</p>
                </article>
                <article className="rounded-2xl border border-green-100 bg-white p-4 shadow-sm">
                  <p className="text-sm font-semibold text-slate-500">Produk Tersedia</p>
                  <p className="mt-2 text-3xl font-extrabold text-green-900">
                    {menus.filter((menu) => menu.is_available).length}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Menu yang dapat dipesan</p>
                </article>
              </section>
            )}

            {/* KELOLA MENU */}
                        {activeSection === 'menu-admin' && (
<section id="menu-admin" className={sectionClass}>
              <div className="mb-5">
                <h2 className="break-words text-lg font-extrabold text-green-900">
                  {editingMenu ? 'Edit Produk' : 'Tambah Menu'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Lengkapi informasi produk dan foto menu restoran.
                </p>
              </div>

              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nama produk"
                className={inputClass}
              />

              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-4">
                <div className="min-w-0">
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Kategori Produk
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className={inputClass}
                  >
                    <option value="makanan">Makanan</option>
                    <option value="minuman">Minuman</option>
                    <option value="cemilan">Cemilan</option>
                  </select>
                </div>
                <div className="min-w-0">
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Harga Produk
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="Harga produk"
                    className={inputClass}
                  />
                </div>
              </div>

              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Deskripsi produk"
                className={inputClass}
                rows={3}
              />

              <div className="mb-4 min-w-0 rounded-2xl border border-dashed border-green-300 bg-green-50/50 p-4 sm:p-5">
                <div className="mb-3">
                  <p className="font-bold text-green-900">Foto Produk</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Pilih foto produk agar pelanggan mudah mengenali menu.
                  </p>
                </div>
                <label className="flex min-w-0 cursor-pointer flex-col items-center justify-center rounded-xl border border-green-100 bg-white px-3 py-5 text-center transition hover:bg-green-50">
                  <span className="text-sm font-bold text-green-800">
                    Pilih Foto Produk
                  </span>
                  <span className="mt-1 text-xs text-slate-500">
                    Format gambar yang didukung perangkat
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoChange}
                    className="mt-3 block w-full min-w-0 max-w-full text-sm"
                  />
                </label>

                {(previewUrl || existingImageUrl) && (
                  <div className="mt-4 min-w-0 rounded-xl border border-slate-200 bg-white p-3">
                    <p className="mb-2 text-sm font-semibold text-slate-700">
                      Pratinjau Foto Produk
                    </p>
                    <img
                      src={previewUrl || existingImageUrl}
                      alt="Pratinjau produk"
                      className="max-h-64 w-full rounded-xl object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFile(null);
                        setExistingImageUrl('');
                      }}
                      className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                    >
                      Hapus Foto
                    </button>
                  </div>
                )}
              </div>

              {error && (
                <p className="mb-3 break-words rounded-lg bg-red-100 p-3 text-sm text-red-800">
                  {error}
                </p>
              )}

              <button
                type="button"
                onClick={addMenu}
                disabled={saving}
                className={`${buttonClass} bg-green-800 text-white hover:bg-green-900`}
              >
                {saving
                  ? 'Menyimpan...'
                  : editingMenu
                    ? 'Simpan Perubahan'
                    : 'Simpan Produk'}
              </button>

              {editingMenu && (
                <button
                  type="button"
                  onClick={cancelEdit}
                  className={`${buttonClass} mt-2 bg-slate-200 text-slate-700`}
                >
                  Batal Edit
                </button>
              )}
            </section>
            )}

            {/* DAFTAR MENU */}
            {activeSection === 'menu-admin' && (
              <section id="daftar-menu-admin" className={sectionClass}>
                <div className="mb-5">
                  <h2 className="text-lg font-extrabold text-green-900">
                    Daftar Produk
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Kelola informasi dan ketersediaan menu restoran.
                  </p>
                  <p className="mt-2 text-sm font-semibold text-green-800">
                    {menus.length} produk terdaftar
                  </p>
                </div>

                {menus.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                    <p className="font-semibold text-slate-600">
                      Belum ada produk.
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Produk yang ditambahkan akan muncul di sini.
                    </p>
                  </div>
                ) : (
                  <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {menus.map((menu) => (
                      <article
                        key={menu.id}
                        className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
                      >
                        {menu.image_url ? (
                          <img
                            src={menu.image_url}
                            alt={menu.name}
                            className="h-44 w-full bg-slate-100 object-cover"
                          />
                        ) : (
                          <div className="flex h-44 items-center justify-center bg-slate-100">
                            <span className="text-sm font-medium text-slate-400">
                              Foto belum tersedia
                            </span>
                          </div>
                        )}

                        <div className="flex min-w-0 flex-1 flex-col p-4">
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold capitalize text-green-800">
                              {menu.category}
                            </span>
                            <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                              menu.is_available
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-700'
                            }`}>
                              {menu.is_available ? 'Tersedia' : 'Tidak tersedia'}
                            </span>
                          </div>

                          <h3 className="break-words text-base font-bold text-slate-900">
                            {menu.name}
                          </h3>
                          <p className="mt-2 text-lg font-extrabold text-green-800">
                            {rupiah(Number(menu.price) || 0)}
                          </p>

                          <div className="mt-auto grid grid-cols-3 gap-2 pt-4">
                            <button
                              type="button"
                              onClick={() => startEdit(menu)}
                              className="rounded-lg bg-blue-50 px-2 py-2 text-xs font-bold text-blue-800 hover:bg-blue-100"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleAvailability(menu)}
                              className="rounded-lg bg-amber-50 px-2 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100"
                            >
                              Ubah Status
                            </button>
                            <button
                              type="button"
                              onClick={() => removeMenu(menu)}
                              className="rounded-lg bg-red-50 px-2 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                            >
                              Hapus
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}

          </div>
        </div>
      </div>
    </main>
  );
}
