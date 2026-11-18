
import { useState, useEffect, useMemo, useRef } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  where,
  getDocs,
  getDoc
} from 'firebase/firestore';

import { db, auth } from '../firebase';

type PaymentMethod = 'tunai' | 'non_tunai';
type CashierPage =
  | 'dashboard'
  | 'pesanan'
  | 'riwayat'
  | 'laporan'
  | 'meja'
  | 'akun';

type OrderItem = {
  item_name: string;
  item_price: number;
  quantity: number;
  subtotal: number;
};

type Order = {
  id: string;
  order_code: string;
  customer_name: string;
  table_number: number;
  total_amount: number;
  status: string;
  payment_status: string;
  payment_method?: PaymentMethod;
  created_at: unknown;
  paid_at?: unknown;
  paid_by?: string;
  table_session_id?: string;
  cashier_archived_at?: unknown;
  cashier_archived_by?: string;
};

type TableRecord = {
  table_number?: number;
  Table_number?: number;
  table_status?: string;
  table_session_id?: string;
  is_active?: boolean;
  table_name?: string;
};

type OrderGroup = [string, Order[]];
type ReportFilter = 'today' | 'yesterday' | 'last7' | 'custom';

type CashierProfile = {
  full_name?: string;
  role?: string;
};

const TOTAL_TABLES = 50;

const isOrderInCurrentTableSession = (
  order: Order,
  tableRecords: TableRecord[]
): boolean => {
  if (order.cashier_archived_at) return false;

  const tableNumber = Number(order.table_number);
  if (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > TOTAL_TABLES) {
    return false;
  }

  const table = tableRecords.find(
    item => Number(item.table_number ?? item.Table_number) === tableNumber
  );

  if (!table) return true;
  if (table.table_status === 'kosong') return false;
  if (
    table.table_status &&
    !['terisi', 'perlu_dibersihkan'].includes(table.table_status)
  ) return false;

  const tableSessionId = String(table.table_session_id || '').trim();
  const orderSessionId = String(order.table_session_id || '').trim();

  if (tableSessionId || orderSessionId) {
    return Boolean(tableSessionId && orderSessionId && tableSessionId === orderSessionId);
  }

  // Fallback untuk data lama yang belum memiliki ID sesi.
  return true;
};


const cashierNavigation: {
  id: CashierPage | 'keluar';
  label: string;
  description: string;
}[] = [
  { id: 'dashboard', label: 'Dashboard', description: 'Ringkasan aktivitas kasir.' },
  { id: 'pesanan', label: 'Transaksi / Pembayaran', description: 'Pesanan aktif dan pembayaran.' },
  { id: 'meja', label: 'Panel Status Meja', description: 'Pemantauan kondisi meja.' },
  { id: 'riwayat', label: 'Riwayat Pesanan', description: 'Daftar pesanan selesai dan dibatalkan.' },
  { id: 'laporan', label: 'Riwayat Kas', description: 'Rekap pemasukan dan transaksi.' },
  { id: 'akun', label: 'Profil Kasir', description: 'Informasi profil akun kasir.' },
  { id: 'keluar', label: 'Keluar', description: 'Keluar dari akun kasir.' }
];

const rupiah = (value: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value);

function getOrderDate(value: unknown): Date | null {
  try {
    if (!value) return null;

    let date: Date;

    if (
      typeof value === 'object' &&
      value !== null &&
      'toDate' in value &&
      typeof value.toDate === 'function'
    ) {
      date = value.toDate();
    } else {
      date = new Date(value as string | number);
    }

    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function getWibDateKey(value: unknown): string {
  const date = getOrderDate(value);
  if (!date) return 'tanggal-tidak-diketahui';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find(part => part.type === type)?.value ?? '';

  return `${get('year')}-${get('month')}-${get('day')}`;
}

function getTodayWibKey(): string {
  return getWibDateKey(new Date());
}

function shiftDateKey(key: string, amount: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount, 12));

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function formatDate(value: unknown) {
  const date = getOrderDate(value);
  if (!date) return '-';

  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

function formatGroupDate(key: string) {
  if (key === 'tanggal-tidak-diketahui') {
    return 'Tanggal Tidak Diketahui';
  }

  if (key === getTodayWibKey()) return 'Hari Ini';

  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));

  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function groupOrdersByDate(orders: Order[]): OrderGroup[] {
  const groups: Record<string, Order[]> = {};

  orders.forEach(order => {
    const key = getWibDateKey(order.created_at);
    if (!groups[key]) groups[key] = [];
    groups[key].push(order);
  });

  return Object.entries(groups).sort(([a], [b]) => {
    if (a === 'tanggal-tidak-diketahui') return 1;
    if (b === 'tanggal-tidak-diketahui') return -1;
    return b.localeCompare(a);
  });
}

export default function KasirView({ onLogout }: { onLogout: () => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [tables, setTables] = useState<TableRecord[]>([]);
  const [tableLoading, setTableLoading] = useState(true);
  const [processingTableNumber, setProcessingTableNumber] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [activePage, setActivePage] = useState<CashierPage>('dashboard');
  const activePageInfo = cashierNavigation.find(item => item.id === activePage);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());


  const [search, setSearch] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [showDetail, setShowDetail] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [detailItems, setDetailItems] = useState<OrderItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('tunai');
  const [processingPayment, setProcessingPayment] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  const [receipt, setReceipt] = useState<{
    order: Order;
    items: OrderItem[];
  } | null>(null);

  const [reportFilter, setReportFilter] = useState<ReportFilter>('today');
  const [reportStartDate, setReportStartDate] = useState(getTodayWibKey());
  const [reportEndDate, setReportEndDate] = useState(getTodayWibKey());

  // Data akun kasir yang sedang login pada perangkat ini.
  const currentUser = auth.currentUser;
  const cashierUid = currentUser?.uid ?? '';
  const cashierEmail = currentUser?.email ?? '';
  const [cashierProfile, setCashierProfile] = useState<CashierProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    const ordersQuery = query(
      collection(db, 'orders'),
      orderBy('created_at', 'desc')
    );

    return onSnapshot(
      ordersQuery,
      snapshot => {
        const loadedOrders = snapshot.docs.map(item => ({
          id: item.id,
          ...item.data()
        })) as Order[];

        setOrders(loadedOrders);
        setLoading(false);
        setError('');
      },
      err => {
        console.error('Gagal membaca pesanan:', err);
        setError('Gagal membaca pesanan. Periksa login dan hak akses kasir.');
        setLoading(false);
      }
    );
  }, []);

  // Membaca status meja secara realtime dari Firestore.
  useEffect(() => {
    return onSnapshot(
      collection(db, 'restaurant_tables'),
      snapshot => {
        const loadedTables = snapshot.docs
          .map(item => {
            const data = item.data() as TableRecord;
            const idNumber = Number(item.id.match(/\d+/)?.[0] ?? 0);
            const tableNumber = Number(
              data.table_number ?? data.Table_number ?? idNumber
            );

            return { ...data, table_number: tableNumber };
          })
          .filter(table =>
            Number.isInteger(table.table_number) &&
            Number(table.table_number) >= 1 &&
            Number(table.table_number) <= TOTAL_TABLES
          );

        setTables(loadedTables);
        setTableLoading(false);
      },
      err => {
        console.error('Gagal membaca status meja:', err);
        setError('Gagal membaca status meja. Periksa koneksi dan hak akses kasir.');
        setTableLoading(false);
      }
    );
  }, []);

  // Membaca dokumen profil milik akun yang sedang login.
  useEffect(() => {
    let active = true;

    const loadCashierProfile = async () => {
      setProfileLoading(true);
      setProfileError('');
      setCashierProfile(null);

      const user = auth.currentUser;

      if (!user) {
        if (active) {
          setProfileLoading(false);
          setProfileError('Tidak ada akun kasir yang sedang login.');
        }
        return;
      }

      try {
        const profileSnapshot = await getDoc(
          doc(db, 'staff_profiles', user.uid)
        );

        if (!profileSnapshot.exists()) {
          throw new Error('Profil staf tidak ditemukan.');
        }

        const profile = profileSnapshot.data() as CashierProfile;

        if (active) {
          setCashierProfile(profile);
        }
      } catch (err) {
        console.error('Gagal membaca profil kasir:', err);
        if (active) {
          setProfileError(
            err instanceof Error
              ? err.message
              : 'Profil kasir gagal dimuat.'
          );
        }
      } finally {
        if (active) setProfileLoading(false);
      }
    };

    loadCashierProfile();

    return () => {
      active = false;
    };
  }, []);

  const pendingOrders = useMemo(
    () => orders.filter(order =>
      order.payment_status !== 'lunas' &&
      isOrderInCurrentTableSession(order, tables)
    ),
    [orders, tables]
  );

  const selectedOrder =
    orders.find(order => order.id === selectedOrderId) ?? null;

  const summary = useMemo(() => {
    const paidOrders = orders.filter(order => order.payment_status === 'lunas');
    const unpaidOrders = orders.filter(order => order.payment_status === 'belum_lunas');

    const totalIncome = paidOrders.reduce(
      (sum, order) => sum + Number(order.total_amount || 0), 0
    );

    const cashIncome = paidOrders
      .filter(order => order.payment_method === 'tunai')
      .reduce((sum, order) => sum + Number(order.total_amount || 0), 0);

    const nonCashIncome = paidOrders
      .filter(order => order.payment_method === 'non_tunai')
      .reduce((sum, order) => sum + Number(order.total_amount || 0), 0);

    const unpaidAmount = unpaidOrders.reduce(
      (sum, order) => sum + Number(order.total_amount || 0), 0
    );

    return {
      totalOrders: orders.length,
      paidCount: paidOrders.length,
      unpaidCount: unpaidOrders.length,
      totalIncome,
      cashIncome,
      nonCashIncome,
      unpaidAmount
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return orders;

    return orders.filter(order =>
      String(order.order_code || '').toLowerCase().includes(keyword) ||
      String(order.customer_name || '').toLowerCase().includes(keyword)
    );
  }, [orders, search]);

  const groupedOrders = useMemo(
    () => groupOrdersByDate(filteredOrders),
    [filteredOrders]
  );

  const activeOrders = useMemo(
    () => orders.filter(order =>
      isOrderInCurrentTableSession(order, tables)
    ),
    [orders, tables]
  );

  const filteredActiveOrders = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return activeOrders;

    return activeOrders.filter(order =>
      String(order.order_code || '').toLowerCase().includes(keyword) ||
      String(order.customer_name || '').toLowerCase().includes(keyword)
    );
  }, [activeOrders, search]);

  const groupedActiveOrders = useMemo(
    () => groupOrdersByDate(filteredActiveOrders),
    [filteredActiveOrders]
  );

  const historyOrders = useMemo(
    () => orders.filter(order =>
      Boolean(order.cashier_archived_at) ||
      ['selesai', 'dibatalkan'].includes(order.status)
    ),
    [orders]
  );

  const filteredHistoryOrders = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return historyOrders;

    return historyOrders.filter(order =>
      String(order.order_code || '').toLowerCase().includes(keyword) ||
      String(order.customer_name || '').toLowerCase().includes(keyword)
    );
  }, [historyOrders, search]);

  const groupedHistoryOrders = useMemo(
    () => groupOrdersByDate(filteredHistoryOrders),
    [filteredHistoryOrders]
  );

  // Status meja mengikuti dokumen restaurant_tables.
  const tableStatuses = useMemo(() => {
    return Array.from({ length: TOTAL_TABLES }, (_, index) => {
      const tableNumber = index + 1;
      const record = tables.find(
        table => Number(table.table_number ?? table.Table_number) === tableNumber
      );
      const storedStatus = record?.table_status;

      const tableSessionId = String(record?.table_session_id || '').trim();
      const tableOrders = orders
        .filter(order => {
          if (
            Number(order.table_number) !== tableNumber ||
            order.cashier_archived_at ||
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

          // Fallback untuk pesanan lama tanpa ID sesi.
          return true;
        })
        .sort((a, b) => {
          const dateA = getOrderDate(a.created_at)?.getTime() ?? 0;
          const dateB = getOrderDate(b.created_at)?.getTime() ?? 0;
          return dateA - dateB;
        });

      const validStoredStatus = ['terisi', 'perlu_dibersihkan', 'kosong'].includes(
        storedStatus || ''
      );
      const statusKnown = Boolean(record && validStoredStatus);
      const status = validStoredStatus
        ? storedStatus!
        : tableOrders.length > 0
          ? 'terisi'
          : 'perlu_dibersihkan';

      return { tableNumber, tableName: record?.table_name || `Meja ${String(tableNumber).padStart(2, '0')}`, status, statusKnown, orders: tableOrders };
    });
  }, [tables, orders]);

  const occupiedTableCount = useMemo(
    () => tableStatuses.filter(table => table.status === 'terisi').length,
    [tableStatuses]
  );

  const cleaningTableCount = useMemo(
    () => tableStatuses.filter(table => table.status === 'perlu_dibersihkan').length,
    [tableStatuses]
  );

  const emptyTableCount = useMemo(
    () => tableStatuses.filter(table => table.status === 'kosong').length,
    [tableStatuses]
  );

  const unassignedActiveOrders = useMemo(
    () => activeOrders.filter(order => {
      const tableNumber = Number(order.table_number);
      return (
        !Number.isInteger(tableNumber) ||
        tableNumber < 1 ||
        tableNumber > TOTAL_TABLES
      );
    }),
    [activeOrders]
  );

  const reportData = useMemo(() => {
    const today = getTodayWibKey();

    let startKey = today;
    let endKey = today;

    if (reportFilter === 'yesterday') {
      startKey = shiftDateKey(today, -1);
      endKey = startKey;
    } else if (reportFilter === 'last7') {
      startKey = shiftDateKey(today, -6);
      endKey = today;
    } else if (reportFilter === 'custom') {
      startKey = reportStartDate;
      endKey = reportEndDate;
    }

    const invalidRange =
      reportFilter === 'custom' &&
      (!startKey || !endKey || startKey > endKey);

    const paidOrders = orders.filter(order =>
      order.payment_status === 'lunas' &&
      order.status !== 'dibatalkan'
    );

    const paidWithoutDate = paidOrders.filter(
      order => !getOrderDate(order.paid_at)
    );

    const datedPaidOrders = paidOrders.filter(
      order => Boolean(getOrderDate(order.paid_at))
    );

    const filteredPaidOrders = invalidRange
      ? []
      : datedPaidOrders.filter(order => {
          const paymentDate = getWibDateKey(order.paid_at);
          return paymentDate >= startKey && paymentDate <= endKey;
        }).sort((a, b) => {
          const dateA = getOrderDate(a.paid_at)?.getTime() ?? 0;
          const dateB = getOrderDate(b.paid_at)?.getTime() ?? 0;
          return dateB - dateA;
        });

    const totalIncome = filteredPaidOrders.reduce(
      (sum, order) => sum + Number(order.total_amount || 0), 0
    );

    const cashOrders = filteredPaidOrders.filter(
      order => order.payment_method === 'tunai'
    );

    const nonCashOrders = filteredPaidOrders.filter(
      order => order.payment_method === 'non_tunai'
    );

    const unknownMethodOrders = filteredPaidOrders.filter(
      order => !['tunai', 'non_tunai'].includes(order.payment_method || '')
    );

    const sumAmount = (list: Order[]) =>
      list.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);

    return {
      startKey,
      endKey,
      invalidRange,
      transactions: filteredPaidOrders,
      totalIncome,
      transactionCount: filteredPaidOrders.length,
      cashIncome: sumAmount(cashOrders),
      cashCount: cashOrders.length,
      nonCashIncome: sumAmount(nonCashOrders),
      nonCashCount: nonCashOrders.length,
      unknownMethodIncome: sumAmount(unknownMethodOrders),
      unknownMethodCount: unknownMethodOrders.length,
      paidWithoutDate,
      paidWithoutDateIncome: sumAmount(paidWithoutDate)
    };
  }, [orders, reportFilter, reportStartDate, reportEndDate]);

  // Riwayat pembayaran hanya menampilkan pembayaran oleh UID kasir ini.
  const cashierPaymentHistory = useMemo(() => {
    if (!cashierUid) return [];

    return orders
      .filter(order =>
        order.payment_status === 'lunas' &&
        order.paid_by === cashierUid &&
        Boolean(getOrderDate(order.paid_at))
      )
      .sort((a, b) => {
        const dateA = getOrderDate(a.paid_at)?.getTime() ?? 0;
        const dateB = getOrderDate(b.paid_at)?.getTime() ?? 0;
        return dateB - dateA;
      });
  }, [orders, cashierUid]);

  useEffect(() => {
    if (!selectedOrderId || !showDetail) return;

    const timer = window.setTimeout(() => {
      detailRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }, 150);

    return () => window.clearTimeout(timer);
  }, [selectedOrderId, showDetail]);

  useEffect(() => {
    if (!selectedOrderId) {
      setDetailItems([]);
      return;
    }

    let active = true;

    const loadItems = async () => {
      setDetailLoading(true);
      setDetailItems([]);

      try {
        const snapshot = await getDocs(
          query(
            collection(db, 'order_items'),
            where('order_id', '==', selectedOrderId)
          )
        );

        const items = snapshot.docs.map(itemDoc => {
          const data = itemDoc.data();

          return {
            item_name: String(data.item_name ?? ''),
            item_price: Number(data.item_price ?? 0),
            quantity: Number(data.quantity ?? 0),
            subtotal: Number(data.subtotal ?? 0)
          };
        });

        if (active) setDetailItems(items);
      } catch (err) {
        console.error('Gagal mengambil rincian pesanan:', err);
        if (active) {
          setError('Rincian pesanan gagal dimuat. Silakan pilih pesanan kembali.');
        }
      } finally {
        if (active) setDetailLoading(false);
      }
    };

    loadItems();

    return () => {
      active = false;
    };
  }, [selectedOrderId]);

  useEffect(() => {
    if (
      activePage === 'pesanan' &&
      selectedOrder &&
      !activeOrders.some(order => order.id === selectedOrder.id)
    ) {
      setSelectedOrderId('');
      setShowDetail(true);
    }
  }, [activePage, selectedOrder, activeOrders]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups(previous => ({
      ...previous,
      [key]: !previous[key]
    }));
  };

  const updateTableStatus = async (
    tableNumber: number,
    targetStatus: 'perlu_dibersihkan' | 'kosong'
  ) => {
    if (processingTableNumber !== null) return;

    setProcessingTableNumber(tableNumber);
    setError('');

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('Sesi login berakhir. Silakan login kembali.');
      }

      const idToken = await user.getIdToken();
      const response = await fetch('/api/update-table-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          table_number: tableNumber,
          table_status: targetStatus
        })
      });

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(result.error || 'Gagal memperbarui status meja.');
      }

      setError('');
    } catch (err) {
      console.error('Gagal memperbarui status meja:', err);
      setError(
        err instanceof Error ? err.message : 'Gagal memperbarui status meja.'
      );
    } finally {
      setProcessingTableNumber(null);
    }
  };

  const markPaid = async (order: Order) => {
    if (processingPayment) return;

    if (order.payment_status === 'lunas') {
      setError('Pesanan ini sudah lunas.');
      return;
    }

    const methodLabel = paymentMethod === 'tunai' ? 'TUNAI' : 'NON-TUNAI';

    const confirmed = window.confirm(
      `Konfirmasi pembayaran ${methodLabel} sebesar ${rupiah(
        order.total_amount
      )} untuk pesanan ${order.order_code}?`
    );

    if (!confirmed) return;

    setProcessingPayment(true);
    setError('');

    try {
      const user = auth.currentUser;

      if (!user) {
        throw new Error('Sesi login berakhir. Silakan login kembali.');
      }

      const idToken = await user.getIdToken();

      const response = await fetch('/api/record-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          order_id: order.id,
          payment_method: paymentMethod
        })
      });

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(result.error || 'Pembayaran gagal dicatat.');
      }

      setError('');
    } catch (err) {
      console.error('Gagal mencatat pembayaran:', err);
      setError(
        err instanceof Error ? err.message : 'Pembayaran gagal dicatat.'
      );
    } finally {
      setProcessingPayment(false);
    }
  };

  const printReceipt = async (order: Order) => {
    setError('');

    try {
      const snapshot = await getDocs(
        query(
          collection(db, 'order_items'),
          where('order_id', '==', order.id)
        )
      );

      const items = snapshot.docs.map(itemDoc => {
        const data = itemDoc.data();

        return {
          item_name: String(data.item_name ?? ''),
          item_price: Number(data.item_price ?? 0),
          quantity: Number(data.quantity ?? 0),
          subtotal: Number(data.subtotal ?? 0)
        };
      });

      setReceipt({ order, items });
    } catch (err) {
      console.error('Gagal mengambil rincian struk:', err);
      setError('Gagal mengambil rincian struk.');
    }
  };

  const renderTableStatus = () => (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-green-950">Status Meja</h1>
          <p className="mt-1 text-sm text-gray-500">
            Pemantauan dan pengaturan kondisi 50 meja oleh Kasir
          </p>
        </div>
        <span className="rounded-xl border border-green-100 bg-white px-4 py-2 text-xs font-bold text-green-900">
          Pembaruan Realtime
        </span>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-green-100 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-green-500" />
            <p className="text-xs font-bold text-gray-500">MEJA KOSONG</p>
          </div>
          <p className="mt-2 text-3xl font-extrabold text-green-800">
            {tableLoading ? '—' : emptyTableCount}
          </p>
          <p className="mt-1 text-xs text-gray-400">Siap menerima pesanan QR</p>
        </div>

        <div className="rounded-2xl border border-amber-100 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-amber-500" />
            <p className="text-xs font-bold text-gray-500">PERLU DIBERSIHKAN</p>
          </div>
          <p className="mt-2 text-3xl font-extrabold text-amber-700">
            {tableLoading ? '—' : cleaningTableCount}
          </p>
          <p className="mt-1 text-xs text-gray-400">Perlu dibersihkan sebelum meja digunakan kembali</p>
        </div>

        <div className="rounded-2xl border border-red-100 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-red-500" />
            <p className="text-xs font-bold text-gray-500">MEJA TERISI</p>
          </div>
          <p className="mt-2 text-3xl font-extrabold text-red-700">
            {tableLoading ? '—' : occupiedTableCount}
          </p>
          <p className="mt-1 text-xs text-gray-400">Menunggu pelanggan menyelesaikan kunjungan</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-green-100 bg-white p-4 text-xs font-semibold text-gray-700">
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded bg-green-500" />
          Kosong
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded bg-amber-500" />
          Perlu dibersihkan
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded bg-red-500" />
          Terisi
        </span>
      </div>

      {tableLoading ? (
        <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center text-sm text-gray-500">
          Memuat status meja...
        </div>
      ) : (
        <div className="rounded-2xl border border-green-100 bg-white p-4 shadow-md">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-extrabold text-gray-900">Denah Status Meja</h2>
              <p className="text-xs text-gray-500">Meja 01 sampai 50</p>
            </div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700">
              {TOTAL_TABLES} Meja
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {tableStatuses.map(table => {
              const isOccupied = table.status === 'terisi';
              const needsCleaning = table.status === 'perlu_dibersihkan';
              const isEmpty = table.status === 'kosong';

              const colorClass = isOccupied
                ? 'border-red-300 bg-red-100 text-red-900'
                : needsCleaning
                  ? 'border-amber-300 bg-amber-100 text-amber-900'
                  : 'border-green-300 bg-green-100 text-green-900';

              const record = tables.find(
                item => Number(item.table_number ?? item.Table_number) === table.tableNumber
              );

              const tableName = record?.table_name ||
                `Meja ${String(table.tableNumber).padStart(2, '0')}`;

              const handleTableClick = () => {
                if (!table.statusKnown || processingTableNumber !== null) return;

                if (isOccupied) {
                  if (window.confirm(
                    `Pelanggan meja ${String(table.tableNumber).padStart(2, '0')} sudah selesai dan meninggalkan meja?`
                  )) {
                    void updateTableStatus(table.tableNumber, 'perlu_dibersihkan');
                  }
                  return;
                }

                if (needsCleaning) {
                  if (window.confirm(
                    `Meja ${String(table.tableNumber).padStart(2, '0')} sudah dibersihkan dan siap digunakan kembali?`
                  )) {
                    void updateTableStatus(table.tableNumber, 'kosong');
                  }
                }
              };

              return (
                <button
                  key={table.tableNumber}
                  type="button"
                  disabled={
                    processingTableNumber !== null ||
                    !table.statusKnown ||
                    isEmpty
                  }
                  aria-label={`${tableName}, nomor ${table.tableNumber}, status ${
                    isOccupied ? 'terisi' : needsCleaning ? 'perlu dibersihkan' : 'kosong'
                  }`}
                  aria-busy={processingTableNumber === table.tableNumber}
                  onClick={handleTableClick}
                  className={`aspect-square w-full min-w-0 rounded-2xl border-2 p-2 flex flex-col items-center justify-center gap-2 text-center shadow-sm transition ${
                    colorClass
                  } ${
                    !table.statusKnown || isEmpty || processingTableNumber !== null
                      ? 'cursor-not-allowed opacity-80'
                      : 'cursor-pointer hover:brightness-95 active:scale-95'
                  }`}
                >
                  <span className="text-2xl font-extrabold leading-none">
                    {String(table.tableNumber).padStart(2, '0')}
                  </span>
                  <span className="max-w-full break-words text-xs font-bold leading-tight">
                    {tableName}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {unassignedActiveOrders.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-extrabold text-amber-900">
            Perlu Pemeriksaan Nomor Meja
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            Ada {unassignedActiveOrders.length} pesanan aktif dengan nomor meja
            di luar rentang 01–50 atau nomor meja yang tidak valid. Pesanan
            tersebut tidak dimasukkan ke kartu meja.
          </p>
          <div className="mt-3 space-y-2">
            {unassignedActiveOrders.map(order => (
              <div key={order.id} className="rounded-lg bg-white p-3 text-xs">
                <p className="font-bold text-gray-800">{order.order_code}</p>
                <p className="mt-1 text-gray-600">{order.customer_name}</p>
                <p className="mt-1 text-amber-800">
                  Nomor meja: {String(order.table_number)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
        <p className="text-xs font-extrabold text-blue-900">INFORMASI STATUS MEJA</p>
        <p className="mt-1 text-xs leading-relaxed text-blue-800">
          Meja TERISI tidak menerima pesanan QR baru, termasuk setelah pembayaran
          LUNAS. Setelah pelanggan meninggalkan meja, Kasir menandainya PERLU
          DIBERSIHKAN. Setelah dibersihkan, Kasir wajib mengonfirmasi menjadi
          KOSONG agar QR dapat digunakan kembali. Pembayaran dan kondisi meja
          merupakan dua hal yang terpisah.
        </p>
      </div>
    </>
  );

  const renderOrderList = (
    groups: OrderGroup[],
    mode: 'active' | 'history' | 'dashboard'
  ) => {
    if (groups.length === 0) {
      return (
        <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center">
          <p className="text-3xl">📋</p>
          <p className="mt-3 font-bold text-gray-700">
            {search ? 'Pesanan tidak ditemukan' : 'Belum ada pesanan'}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Pesanan akan muncul di sini setelah diterima sistem.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {groups.map(([dateKey, groupOrders]) => (
          <section
            key={dateKey}
            className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"
          >
            <button
              type="button"
              onClick={() => toggleGroup(dateKey)}
              className="flex w-full items-center justify-between gap-3 bg-gray-50 px-4 py-3 text-left"
            >
              <div>
                <p className="text-sm font-extrabold text-gray-800">
                  {formatGroupDate(dateKey)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {groupOrders.length} pesanan
                </p>
              </div>
              <span className="text-gray-500">
                {collapsedGroups[dateKey] ? '＋' : '−'}
              </span>
            </button>

            {!collapsedGroups[dateKey] && (
              <div className="divide-y divide-gray-100">
                {groupOrders.map(order => {
                  const selected = selectedOrderId === order.id;

                  return (
                    <button
                      type="button"
                      key={order.id}
                      onClick={() => {
                        setSelectedOrderId(order.id);
                        setShowDetail(true);
                      }}
                      className={`w-full p-4 text-left transition ${
                        selected ? 'bg-green-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-extrabold text-gray-900">
                            {order.order_code || 'Tanpa nomor pesanan'}
                          </p>
                          <p className="mt-1 text-sm text-gray-700">
                            {order.customer_name || 'Pelanggan'}
                          </p>
                          <p className="mt-1 text-xs text-gray-500">
                            Meja {String(order.table_number).padStart(2, '0')}
                            {' · '}
                            {formatDate(order.created_at)}
                          </p>
                        </div>

                        <div className="text-right">
                          <p className="text-sm font-extrabold text-gray-900">
                            {rupiah(Number(order.total_amount || 0))}
                          </p>
                          <span className="mt-2 inline-block rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-700">
                            {activeOrders.some(item => item.id === order.id)
                              ? ({
                                  terisi: 'MEJA TERISI',
                                  perlu_dibersihkan: 'PERLU DIBERSIHKAN',
                                  kosong: 'KOSONG'
                                }[tableStatuses.find(item => item.tableNumber === Number(order.table_number))?.status || 'terisi'])
                              : 'RIWAYAT'}
                          </span>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                          order.payment_status === 'lunas'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {order.payment_status === 'lunas' ? 'LUNAS' : 'BELUM LUNAS'}
                        </span>
                        {mode === 'history' && (
                          <span className="text-[10px] font-semibold text-gray-400">
                            Buka rincian riwayat
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        ))}
      </div>
    );
  };

  const renderOrderDetail = () => {
    if (!selectedOrder) {
      return (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-3xl">👈</p>
          <p className="mt-3 font-bold text-gray-700">
            Pilih pesanan untuk melihat rincian
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Rincian pesanan akan ditampilkan di panel ini.
          </p>
        </div>
      );
    }

    return (
      <div ref={detailRef} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
              Rincian Pesanan
            </p>
            <h2 className="mt-1 break-words text-lg font-extrabold text-gray-900">
              {selectedOrder.order_code}
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              {selectedOrder.customer_name}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedOrderId('');
              setShowDetail(true);
            }}
            className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-bold text-gray-600"
          >
            Tutup
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 py-4">
          <div className="rounded-xl bg-gray-50 p-3">
            <p className="text-[10px] font-bold text-gray-400">NOMOR MEJA</p>
            <p className="mt-1 text-lg font-extrabold text-gray-900">
              {String(selectedOrder.table_number).padStart(2, '0')}
            </p>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            <p className="text-[10px] font-bold text-gray-400">WAKTU PESAN</p>
            <p className="mt-1 text-xs font-bold text-gray-800">
              {formatDate(selectedOrder.created_at)}
            </p>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700">
            {activeOrders.some(order => order.id === selectedOrder.id)
              ? ({
                  terisi: 'MEJA TERISI',
                  perlu_dibersihkan: 'PERLU DIBERSIHKAN',
                  kosong: 'KOSONG'
                }[tableStatuses.find(item => item.tableNumber === Number(selectedOrder.table_number))?.status || 'terisi'])
              : 'RIWAYAT'}
          </span>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${
            selectedOrder.payment_status === 'lunas'
              ? 'bg-green-100 text-green-800'
              : 'bg-amber-100 text-amber-800'
          }`}>
            {selectedOrder.payment_status === 'lunas' ? 'LUNAS' : 'BELUM LUNAS'}
          </span>
        </div>

        <h3 className="mb-3 text-sm font-extrabold text-gray-800">
          Daftar Menu
        </h3>

        {detailLoading ? (
          <p className="py-5 text-center text-sm text-gray-500">
            Memuat rincian menu...
          </p>
        ) : detailItems.length === 0 ? (
          <p className="py-5 text-center text-sm text-gray-500">
            Rincian menu tidak tersedia.
          </p>
        ) : (
          <div className="space-y-3">
            {detailItems.map((item, index) => (
              <div key={`${item.item_name}-${index}`} className="flex justify-between gap-3 border-b border-gray-100 pb-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-bold text-gray-800">
                    {item.item_name}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {item.quantity} × {rupiah(item.item_price)}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-bold text-gray-800">
                  {rupiah(item.subtotal)}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-dashed border-gray-300 pt-4">
          <span className="font-bold text-gray-700">TOTAL</span>
          <span className="text-xl font-extrabold text-green-800">
            {rupiah(Number(selectedOrder.total_amount || 0))}
          </span>
        </div>

        {activePage === 'pesanan' && activeOrders.some(order => order.id === selectedOrder.id) && (
          <div className="mt-5 space-y-3">
            {selectedOrder.payment_status !== 'lunas' ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-extrabold text-amber-900">
                  PEMBAYARAN DI KASIR
                </p>
                <p className="mt-1 text-xs text-amber-800">
                  Pilih metode pembayaran setelah pelanggan membayar.
                </p>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('tunai')}
                    className={`rounded-lg border p-3 text-sm font-bold ${
                      paymentMethod === 'tunai'
                        ? 'border-green-600 bg-green-100 text-green-900'
                        : 'border-gray-200 bg-white text-gray-600'
                    }`}
                  >
                    Tunai
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('non_tunai')}
                    className={`rounded-lg border p-3 text-sm font-bold ${
                      paymentMethod === 'non_tunai'
                        ? 'border-green-600 bg-green-100 text-green-900'
                        : 'border-gray-200 bg-white text-gray-600'
                    }`}
                  >
                    Non-Tunai
                  </button>
                </div>

                <button
                  type="button"
                  disabled={processingPayment}
                  onClick={() => markPaid(selectedOrder)}
                  className="mt-3 w-full rounded-xl bg-green-700 px-4 py-3 text-sm font-extrabold text-white disabled:opacity-50"
                >
                  {processingPayment ? 'Memproses...' : 'KONFIRMASI PEMBAYARAN LUNAS'}
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-green-200 bg-green-50 p-3">
                <p className="text-sm font-extrabold text-green-800">
                  PEMBAYARAN SUDAH LUNAS
                </p>
                <p className="mt-1 text-xs text-green-700">
                  Pembayaran telah dicatat. Kondisi meja tetap mengikuti Panel Status Meja.
                </p>
              </div>
            )}

          </div>
        )}

        <button
          type="button"
          onClick={() => printReceipt(selectedOrder)}
          className="mt-4 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-extrabold text-gray-700"
        >
          CETAK / LIHAT STRUK
        </button>
      </div>
    );
  };

  const renderHistoryDetail = () => {
    if (!selectedOrder) {
      return (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="font-bold text-gray-700">Pilih riwayat pesanan</p>
          <p className="mt-1 text-sm text-gray-500">
            Rincian pesanan yang dipilih akan muncul di sini.
          </p>
        </div>
      );
    }

    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-4">
          <div className="min-w-0">
            <p className="text-xs font-bold text-gray-400">DETAIL RIWAYAT</p>
            <h2 className="mt-1 break-words text-lg font-extrabold text-gray-900">
              {selectedOrder.order_code}
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              {selectedOrder.customer_name}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSelectedOrderId('')}
            className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-bold text-gray-600"
          >
            Tutup
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${
            selectedOrder.payment_status === 'lunas'
              ? 'bg-green-100 text-green-800'
              : 'bg-amber-100 text-amber-800'
          }`}>
            {selectedOrder.payment_status === 'lunas' ? 'LUNAS' : 'BELUM LUNAS'}
          </span>
        </div>

        <div className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Meja</span>
            <strong>{String(selectedOrder.table_number).padStart(2, '0')}</strong>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Waktu Pesanan</span>
            <strong className="text-right">{formatDate(selectedOrder.created_at)}</strong>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Waktu Pembayaran</span>
            <strong className="text-right">{formatDate(selectedOrder.paid_at)}</strong>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Metode Pembayaran</span>
            <strong>
              {selectedOrder.payment_method === 'tunai'
                ? 'Tunai'
                : selectedOrder.payment_method === 'non_tunai'
                  ? 'Non-Tunai'
                  : '-'}
            </strong>
          </div>
        </div>

        <div className="mt-4 border-t border-gray-100 pt-4">
          <p className="mb-3 text-sm font-extrabold text-gray-800">Rincian Menu</p>
          {detailLoading ? (
            <p className="text-sm text-gray-500">Memuat rincian...</p>
          ) : detailItems.length === 0 ? (
            <p className="text-sm text-gray-500">Rincian menu tidak tersedia.</p>
          ) : (
            <div className="space-y-3">
              {detailItems.map((item, index) => (
                <div key={`${item.item_name}-${index}`} className="flex justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-gray-800">{item.item_name}</p>
                    <p className="text-xs text-gray-500">
                      {item.quantity} × {rupiah(item.item_price)}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-gray-800">{rupiah(item.subtotal)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-between border-t border-dashed border-gray-300 pt-4">
          <span className="font-bold text-gray-700">TOTAL</span>
          <span className="text-lg font-extrabold text-green-800">
            {rupiah(Number(selectedOrder.total_amount || 0))}
          </span>
        </div>

        <button
          type="button"
          onClick={() => printReceipt(selectedOrder)}
          className="mt-4 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-extrabold text-gray-700"
        >
          LIHAT / CETAK STRUK
        </button>
      </div>
    );
  };

  const renderReport = () => (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-green-950">Laporan Kas</h1>
        <p className="mt-1 text-sm text-gray-500">
          Ringkasan transaksi pembayaran berdasarkan waktu pembayaran.
        </p>
      </div>

      <div className="mb-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-extrabold text-gray-800">Filter Periode</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([
            ['today', 'Hari Ini'],
            ['yesterday', 'Kemarin'],
            ['last7', '7 Hari Terakhir'],
            ['custom', 'Pilih Tanggal']
          ] as [ReportFilter, string][]).map(([value, label]) => (
            <button
              type="button"
              key={value}
              onClick={() => setReportFilter(value)}
              className={`rounded-xl border px-3 py-2 text-xs font-bold ${
                reportFilter === value
                  ? 'border-green-700 bg-green-700 text-white'
                  : 'border-gray-200 bg-white text-gray-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {reportFilter === 'custom' && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold text-gray-600">
              Tanggal Mulai
              <input
                type="date"
                value={reportStartDate}
                onChange={event => setReportStartDate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm"
              />
            </label>
            <label className="text-xs font-bold text-gray-600">
              Tanggal Akhir
              <input
                type="date"
                value={reportEndDate}
                onChange={event => setReportEndDate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm"
              />
            </label>
          </div>
        )}

        <p className="mt-3 text-xs text-gray-500">
          Periode: {reportData.startKey} sampai {reportData.endKey}
        </p>
      </div>

      {reportData.invalidRange && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">
          Rentang tanggal tidak valid. Pastikan tanggal mulai tidak melewati tanggal akhir.
        </div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-green-800 p-5 text-white shadow-sm">
          <p className="text-xs font-bold text-green-100">TOTAL PEMASUKAN</p>
          <p className="mt-2 text-2xl font-extrabold">
            {rupiah(reportData.totalIncome)}
          </p>
          <p className="mt-2 text-xs text-green-100">
            {reportData.transactionCount} transaksi lunas
          </p>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold text-gray-500">RATA-RATA TRANSAKSI</p>
          <p className="mt-2 text-2xl font-extrabold text-gray-900">
            {rupiah(
              reportData.transactionCount
                ? reportData.totalIncome / reportData.transactionCount
                : 0
            )}
          </p>
          <p className="mt-2 text-xs text-gray-400">Per transaksi</p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-gray-100 bg-white p-4">
          <p className="text-xs font-bold text-gray-500">PEMBAYARAN TUNAI</p>
          <p className="mt-2 text-xl font-extrabold text-gray-900">
            {rupiah(reportData.cashIncome)}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {reportData.cashCount} transaksi
          </p>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-4">
          <p className="text-xs font-bold text-gray-500">PEMBAYARAN NON-TUNAI</p>
          <p className="mt-2 text-xl font-extrabold text-gray-900">
            {rupiah(reportData.nonCashIncome)}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {reportData.nonCashCount} transaksi
          </p>
        </div>
      </div>

      {reportData.unknownMethodCount > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Ada {reportData.unknownMethodCount} transaksi dengan metode pembayaran
          yang tidak dikenali, senilai {rupiah(reportData.unknownMethodIncome)}.
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-4">
          <h2 className="font-extrabold text-gray-900">Daftar Transaksi</h2>
          <p className="mt-1 text-xs text-gray-500">
            Urut berdasarkan waktu pembayaran terbaru.
          </p>
        </div>

        {reportData.transactions.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">
            Tidak ada transaksi lunas pada periode ini.
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {reportData.transactions.map(order => (
              <div key={order.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-extrabold text-gray-800">
                    {order.order_code}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {order.customer_name} · Meja {String(order.table_number).padStart(2, '0')}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    Dibayar: {formatDate(order.paid_at)}
                  </p>
                  <p className="mt-1 text-[10px] font-semibold text-gray-500">
                    {order.payment_method === 'tunai'
                      ? 'Tunai'
                      : order.payment_method === 'non_tunai'
                        ? 'Non-Tunai'
                        : 'Metode tidak diketahui'}
                  </p>
                </div>
                <p className="text-sm font-extrabold text-green-800">
                  {rupiah(Number(order.total_amount || 0))}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {reportData.paidWithoutDate.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-extrabold text-amber-900">
            Pembayaran Tanpa Waktu Tercatat
          </p>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            {reportData.paidWithoutDate.length} pesanan lama berstatus lunas
            tidak memiliki data waktu pembayaran. Nilai {rupiah(reportData.paidWithoutDateIncome)}
            {' '}tidak dimasukkan ke total periode karena tanggal transaksinya
            tidak dapat dipastikan.
          </p>
        </div>
      )}
    </>
  );

  const renderCashierAccount = () => (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-green-950">Akun Kasir</h1>
        <p className="mt-1 text-sm text-gray-500">
          Informasi akun yang sedang digunakan pada perangkat ini.
        </p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-green-800 to-green-700 p-5 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-2xl font-extrabold">
              {(cashierProfile?.full_name || 'K').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-green-100">AKUN KASIR</p>
              <h2 className="break-words text-lg font-extrabold">
                {cashierProfile?.full_name || 'Kasir'}
              </h2>
              <span className="mt-1 inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-bold">
                {(cashierProfile?.role || 'kasir').toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-5">
          {profileLoading ? (
            <p className="text-sm text-gray-500">Memuat informasi akun...</p>
          ) : profileError ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {profileError}
            </div>
          ) : (
            <>
              <div>
                <p className="text-xs font-bold text-gray-400">NAMA LENGKAP</p>
                <p className="mt-1 break-words font-bold text-gray-800">
                  {cashierProfile?.full_name || '-'}
                </p>
              </div>
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-bold text-gray-400">EMAIL LOGIN</p>
                <p className="mt-1 break-all font-semibold text-gray-800">
                  {cashierEmail || '-'}
                </p>
              </div>
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-bold text-gray-400">ROLE AKUN</p>
                <p className="mt-1 font-semibold text-gray-800">
                  {cashierProfile?.role || 'kasir'}
                </p>
              </div>
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-bold text-gray-400">UID AKUN</p>
                <p className="mt-1 break-all font-mono text-xs text-gray-700">
                  {cashierUid || '-'}
                </p>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <h2 className="font-extrabold text-gray-900">Sesi Perangkat Ini</h2>
        <div className="mt-3 flex items-center gap-2">
          <span className={`h-3 w-3 rounded-full ${currentUser ? 'bg-green-500' : 'bg-red-500'}`} />
          <p className={`text-sm font-bold ${currentUser ? 'text-green-800' : 'text-red-700'}`}>
            {currentUser ? 'Sedang login' : 'Tidak ada sesi login'}
          </p>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-gray-500">
          Status ini menunjukkan sesi akun pada perangkat yang sedang digunakan.
          Tombol Keluar berada di bagian header aplikasi. Keluar dari perangkat
          ini tidak dimaksudkan untuk mengeluarkan akun dari perangkat kasir lain.
        </p>
      </section>

      <section className="mt-4 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-5">
          <h2 className="font-extrabold text-gray-900">Riwayat Pembayaran Saya</h2>
          <p className="mt-1 text-xs text-gray-500">
            Pembayaran lunas yang tercatat menggunakan UID akun ini.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
          <div className="rounded-xl bg-green-50 p-3">
            <p className="text-[10px] font-bold text-green-700">JUMLAH TRANSAKSI</p>
            <p className="mt-1 text-2xl font-extrabold text-green-900">
              {cashierPaymentHistory.length}
            </p>
          </div>
          <div className="rounded-xl bg-green-50 p-3">
            <p className="text-[10px] font-bold text-green-700">TOTAL PEMBAYARAN</p>
            <p className="mt-1 break-words text-lg font-extrabold text-green-900">
              {rupiah(
                cashierPaymentHistory.reduce(
                  (sum, order) => sum + Number(order.total_amount || 0),
                  0
                )
              )}
            </p>
          </div>
        </div>

        {cashierPaymentHistory.length === 0 ? (
          <p className="px-5 pb-5 text-center text-sm text-gray-500">
            Belum ada pembayaran yang tercatat atas akun ini.
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {cashierPaymentHistory.map(order => (
              <div key={order.id} className="p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-extrabold text-gray-800">
                      {order.order_code}
                    </p>
                    <p className="mt-1 text-xs text-gray-600">
                      {order.customer_name} · Meja {String(order.table_number).padStart(2, '0')}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {formatDate(order.paid_at)}
                    </p>
                    <p className="mt-1 text-[10px] font-semibold text-gray-500">
                      Metode: {order.payment_method === 'tunai'
                        ? 'Tunai'
                        : order.payment_method === 'non_tunai'
                          ? 'Non-Tunai'
                          : '-'}
                    </p>
                  </div>
                  <p className="text-sm font-extrabold text-green-800">
                    {rupiah(Number(order.total_amount || 0))}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
        <p className="text-xs font-extrabold text-blue-900">INFORMASI AKUN</p>
        <p className="mt-1 text-xs leading-relaxed text-blue-800">
          Halaman ini hanya menampilkan informasi akun dan pembayaran yang
          tercatat atas UID kasir yang sedang login. Pengelolaan akun, role,
          dan hak akses tetap menjadi kewenangan Admin.
        </p>
      </div>
    </>
  );

  const handlePrintReceipt = () => {
    if (!receipt) return;

    const printWindow = window.open('', '_blank', 'width=420,height=700');

    if (!printWindow) {
      setError('Jendela cetak diblokir browser. Izinkan pop-up untuk mencetak struk.');
      return;
    }

    const order = receipt.order;
    const itemsHtml = receipt.items.map(item => `
      <div class="item">
        <div>${item.item_name}</div>
        <div class="sub">${item.quantity} x ${rupiah(item.item_price)}</div>
        <div class="price">${rupiah(item.subtotal)}</div>
      </div>
    `).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <title>Struk ${order.order_code}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            width: 75mm;
            margin: 0 auto;
            padding: 5mm;
            color: #111;
            font-family: Arial, sans-serif;
            font-size: 12px;
          }
          .center { text-align: center; }
          .brand { font-size: 18px; font-weight: 800; }
          .small { font-size: 10px; line-height: 1.5; }
          .line { border-top: 1px dashed #333; margin: 10px 0; }
          .row { display: flex; justify-content: space-between; gap: 8px; margin: 5px 0; }
          .item { margin: 8px 0; }
          .sub { color: #555; font-size: 10px; margin-top: 2px; }
          .price { text-align: right; font-weight: 700; margin-top: 2px; }
          .total { font-size: 15px; font-weight: 800; }
          .footer { margin-top: 15px; text-align: center; font-size: 10px; }
          @media print {
            body { width: 75mm; margin: 0; }
          }
        </style>
      </head>
      <body>
        <div class="center">
          <div class="brand">WAROENG BPJS</div>
          <div class="small">
            Jl. Kandangsapi 001/002 No. 01<br />
            Desa Tanjungsari, Kecamatan Sukaluyu<br />
            Kabupaten Cianjur
          </div>
        </div>
        <div class="line"></div>
        <div class="row"><span>No. Pesanan</span><strong>${order.order_code}</strong></div>
        <div class="row"><span>Pelanggan</span><strong>${order.customer_name}</strong></div>
        <div class="row"><span>Meja</span><strong>${String(order.table_number).padStart(2, '0')}</strong></div>
        <div class="row"><span>Waktu</span><strong>${formatDate(order.created_at)}</strong></div>
        <div class="line"></div>
        ${itemsHtml}
        <div class="line"></div>
        <div class="row total"><span>TOTAL</span><span>${rupiah(Number(order.total_amount || 0))}</span></div>
        <div class="row"><span>Pembayaran</span><strong>${order.payment_status === 'lunas' ? 'LUNAS' : 'BELUM LUNAS'}</strong></div>
        <div class="row"><span>Metode</span><strong>${order.payment_method === 'tunai' ? 'Tunai' : order.payment_method === 'non_tunai' ? 'Non-Tunai' : '-'}</strong></div>
        <div class="line"></div>
        <div class="footer">
          Terima kasih telah berkunjung.<br />
          Selamat menikmati pesanan Anda.
        </div>
        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
      </html>
    `);

    printWindow.document.close();
  };

  return (
    <div className="min-h-screen bg-[#f3f8f4]">
      <div className="mx-auto flex min-h-screen max-w-[1600px] gap-0 p-0 lg:gap-5 lg:p-5">
        {mobileSidebarOpen && (
          <button
            type="button"
            aria-label="Tutup menu"
            onClick={() => setMobileSidebarOpen(false)}
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          />
        )}

        <aside
          className={`fixed inset-y-0 left-0 z-50 flex w-72 shrink-0 flex-col border-r border-green-100 bg-white p-5 shadow-2xl transition-transform duration-200 lg:sticky lg:top-4 lg:z-auto lg:h-[calc(100vh-2rem)] lg:w-56 lg:translate-x-0 lg:rounded-2xl lg:border lg:shadow-sm ${
            mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="mb-5 border-b border-green-100 pb-4">
            <div className="flex items-center gap-3">
              <img
                src="/logo.png"
                alt="Logo Waroeng BPJS"
                className="h-14 w-14 shrink-0 object-contain"
              />
              <div className="min-w-0 flex-1 text-center">
                <p className="text-sm font-extrabold tracking-wide text-green-900">
                  WAROENG BPJS
                </p>
                <p className="mt-1 text-[10px] font-semibold text-green-700">
                  Budget pas jajanan sehat
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup menu"
                onClick={() => setMobileSidebarOpen(false)}
                className="rounded-lg px-3 py-2 text-xl text-gray-500 hover:bg-gray-100 lg:hidden"
              >
                ×
              </button>
            </div>
            <p className="mt-3 text-center text-xs font-extrabold text-green-800">
              PANEL KASIR
            </p>
          </div>

          <nav className="flex-1 space-y-1.5 overflow-y-auto">
            {cashierNavigation.map(item => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  setMobileSidebarOpen(false);
                  if (item.id === 'keluar') {
                    onLogout();
                    return;
                  }
                  setActivePage(item.id);
                  setSelectedOrderId('');
                  setSearch('');
                  setError('');
                  setNotificationOpen(false);
                }}
                className={`flex w-full min-w-0 items-center rounded-xl px-3 py-3 text-left transition ${
                  activePage === item.id
                    ? 'bg-green-800 text-white shadow-sm'
                    : 'text-gray-800 hover:bg-green-50'
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-xs font-extrabold">
                    {item.label}
                  </span>
                  <span className={`mt-0.5 block text-[9px] leading-relaxed ${
                    activePage === item.id ? 'text-green-100' : 'text-gray-400'
                  }`}>
                    {item.description}
                  </span>
                </span>
              </button>
            ))}
          </nav>

          <div className="mt-4 border-t border-gray-100 pt-3">
            <p className="text-[10px] text-gray-400">
              WAROENG BPJS · AREA KASIR
            </p>
            <p className="mt-1 text-[10px] font-semibold text-green-800">
              Sistem pelayanan pesanan
            </p>
          </div>
        </aside>

        <main className="min-w-0 flex-1 p-3 sm:p-5 lg:p-0">
          <header className="relative z-30 mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-green-200 bg-white p-3 shadow-md sm:p-4">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                aria-label="Buka menu navigasi"
                onClick={() => setMobileSidebarOpen(true)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-xl text-green-800 hover:bg-green-50 lg:hidden"
              >
                ☰
              </button>

              <div className="min-w-0">
                <p className="text-[10px] font-extrabold tracking-wider text-green-700">
                  WAROENG BPJS · AREA KASIR
                </p>
                <h1 className="mt-1 truncate text-base font-extrabold text-gray-900 sm:text-lg">
                  {activePageInfo?.label || 'Dashboard'}
                </h1>
                <p className="mt-0.5 hidden text-[10px] text-gray-500 sm:block">
                  {activePageInfo?.description}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-[10px] font-bold text-gray-500">
                  {new Intl.DateTimeFormat('id-ID', {
                    timeZone: 'Asia/Jakarta',
                    weekday: 'long',
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                  }).format(currentTime)}
                </p>
                <p className="mt-1 text-xs font-extrabold tabular-nums text-green-800">
                  {new Intl.DateTimeFormat('id-ID', {
                    timeZone: 'Asia/Jakarta',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hourCycle: 'h23'
                  }).format(currentTime)} WIB
                </p>
              </div>

              <div className="relative">
                <button
                  type="button"
                  aria-label="Notifikasi tagihan belum lunas"
                  aria-expanded={notificationOpen}
                  onClick={() => setNotificationOpen(value => !value)}
                  className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-lg text-gray-700 hover:bg-green-50"
                >
                  ♧
                  {pendingOrders.length > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-extrabold text-white ring-2 ring-white">
                      {pendingOrders.length > 99 ? '99+' : pendingOrders.length}
                    </span>
                  )}
                </button>

                {notificationOpen && (
                  <div className="absolute right-0 top-12 z-50 w-[min(90vw,340px)] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
                    <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                      <div>
                        <p className="text-sm font-extrabold text-gray-900">
                          Tagihan Belum Lunas
                        </p>
                        <p className="text-[10px] text-gray-500">
                          {pendingOrders.length} tagihan sesi meja belum lunas
                        </p>
                      </div>
                      <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-extrabold text-red-700">
                        {pendingOrders.length}
                      </span>
                    </div>

                    <div className="max-h-80 overflow-y-auto">
                      {pendingOrders.length === 0 ? (
                        <p className="px-4 py-8 text-center text-xs text-gray-500">
                          Tidak ada tagihan aktif yang belum lunas.
                        </p>
                      ) : (
                        pendingOrders.map(order => (
                          <button
                            type="button"
                            key={order.id}
                            onClick={() => {
                              setActivePage('pesanan');
                              setSelectedOrderId(order.id);
                              setSearch('');
                              setShowDetail(true);
                              setNotificationOpen(false);
                              setMobileSidebarOpen(false);
                            }}
                            className="block w-full border-b border-gray-100 px-4 py-3 text-left transition hover:bg-green-50"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-extrabold text-green-800">
                                {order.order_code || 'Pesanan baru'}
                              </span>
                              <span className="rounded-full bg-amber-100 px-2 py-1 text-[9px] font-bold text-amber-800">
                                BELUM LUNAS
                              </span>
                            </div>
                            <p className="mt-1 truncate text-xs font-semibold text-gray-800">
                              {order.customer_name || 'Pelanggan'}
                            </p>
                            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-gray-500">
                              <span>
                                Meja {String(order.table_number ?? '-').padStart(2, '0')}
                              </span>
                              <span>{formatDate(order.created_at)}</span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setActivePage('pesanan');
                        setSelectedOrderId('');
                        setSearch('');
                        setNotificationOpen(false);
                      }}
                      className="w-full bg-green-50 px-4 py-3 text-xs font-extrabold text-green-800 hover:bg-green-100"
                    >
                      Buka Semua Pesanan Aktif
                    </button>
                  </div>
                )}
              </div>

              <div className="max-w-[125px] rounded-xl bg-green-50 px-2.5 py-2 sm:max-w-[180px] sm:px-3">
                <p className="text-[9px] font-bold text-green-700">
                  AKUN AKTIF
                </p>
                <p className="truncate text-xs font-extrabold text-green-950 sm:text-sm">
                  {cashierProfile?.full_name || cashierEmail || 'Kasir'}
                </p>
              </div>
            </div>

            <div className="w-full text-right text-[10px] font-semibold text-gray-500 sm:hidden">
              {new Intl.DateTimeFormat('id-ID', {
                timeZone: 'Asia/Jakarta',
                weekday: 'short',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23'
              }).format(currentTime)} WIB
            </div>
          </header>

          {error && (
            <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p>{error}</p>
              <button
                type="button"
                onClick={() => setError('')}
                className="font-extrabold"
              >
                ×
              </button>
            </div>
          )}

          {activePage === 'dashboard' && (
            <>
              <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4">
                <div className="rounded-2xl border border-green-200 bg-white p-4 shadow-sm sm:p-5">
                  <p className="text-xs font-bold tracking-wide text-gray-500">SUDAH LUNAS</p>
                  <p className="mt-2 text-3xl font-extrabold text-green-700">
                    {loading ? '—' : summary.paidCount}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">Pesanan telah dibayar</p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm sm:p-5">
                  <p className="text-xs font-bold tracking-wide text-gray-500">BELUM LUNAS</p>
                  <p className="mt-2 text-3xl font-extrabold text-amber-700">
                    {loading ? '—' : summary.unpaidCount}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">Menunggu pembayaran</p>
                </div>
              </div>

              <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4">
                <div className="rounded-2xl border border-green-800 bg-green-800 p-4 text-white shadow-md sm:p-5">
                  <p className="text-xs font-bold text-green-100">TOTAL PEMASUKAN TERCATAT</p>
                  <p className="mt-2 text-2xl font-extrabold">{rupiah(summary.totalIncome)}</p>
                  <p className="mt-1 text-xs text-green-100">Pembayaran berstatus lunas</p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
                  <p className="text-xs font-bold text-gray-500">TOTAL TAGIHAN BELUM LUNAS</p>
                  <p className="mt-2 text-2xl font-extrabold text-amber-700">
                    {rupiah(summary.unpaidAmount)}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">Menunggu pembayaran di kasir</p>
                </div>
              </div>

              <div className="mb-5 rounded-2xl border border-green-100 bg-white p-4 shadow-md sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-extrabold text-gray-900">Pesanan Terbaru</h2>
                    <p className="mt-1 text-xs text-gray-500">
                      Cari berdasarkan nomor pesanan atau nama pelanggan.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActivePage('pesanan')}
                    className="rounded-lg bg-green-700 px-3 py-2 text-xs font-bold text-white"
                  >
                    Lihat Pesanan Aktif
                  </button>
                </div>

                <input
                  type="search"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Cari nomor pesanan / nama pelanggan..."
                  className="mb-4 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-green-600"
                />

                {loading ? (
                  <p className="py-8 text-center text-sm text-gray-500">
                    Memuat pesanan...
                  </p>
                ) : (
                  renderOrderList(groupedOrders, 'dashboard')
                )}
              </div>

              {selectedOrder && (
                <div className="mb-5">
                  {renderOrderDetail()}
                </div>
              )}
            </>
          )}

          {activePage === 'pesanan' && (
            <>
              <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
                {[
                  { label: 'MEJA TERISI', value: occupiedTableCount, color: 'text-red-700' },
                  { label: 'PERLU DIBERSIHKAN', value: cleaningTableCount, color: 'text-amber-700' },
                  { label: 'TAGIHAN BELUM LUNAS', value: pendingOrders.length, color: 'text-blue-700' }
                ].map(item => (
                  <div key={item.label} className="rounded-2xl border border-green-100 bg-white p-4 shadow-sm sm:p-5">
                    <p className="text-[10px] font-bold text-gray-500">{item.label}</p>
                    <p className={`mt-2 text-2xl font-extrabold ${item.color}`}>
                      {loading ? '—' : item.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
                <section className="min-w-0">
                  <div className="mb-3">
                    <h2 className="font-extrabold text-gray-900">Daftar Pesanan Aktif</h2>
                    <p className="mt-1 text-xs text-gray-500">
                      Pesanan dari sesi meja yang masih aktif.
                    </p>
                  </div>
                  <input
                    type="search"
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder="Cari nomor / nama pelanggan..."
                    className="mb-4 w-full rounded-xl border border-green-100 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-green-500 focus:ring-2 focus:ring-green-100"
                  />
                  {loading ? (
                    <div className="rounded-xl bg-white p-6 text-center text-sm text-gray-500">
                      Memuat pesanan...
                    </div>
                  ) : (
                    renderOrderList(groupedActiveOrders, 'active')
                  )}
                </section>

                <section className="min-w-0">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="font-extrabold text-gray-900">Panel Detail</h2>
                    {selectedOrder && (
                      <button
                        type="button"
                        onClick={() => setShowDetail(value => !value)}
                        className="text-xs font-bold text-green-700"
                      >
                        {showDetail ? 'Sembunyikan' : 'Tampilkan'}
                      </button>
                    )}
                  </div>
                  {showDetail && renderOrderDetail()}
                </section>
              </div>
            </>
          )}

          {activePage === 'riwayat' && (
            <>
              <div className="mb-5">
                <h2 className="text-xl font-extrabold text-gray-900">Riwayat Pesanan</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Pesanan yang telah selesai atau dibatalkan. Riwayat hanya untuk dilihat.
                </p>
              </div>

              <input
                type="search"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Cari nomor pesanan / nama pelanggan..."
                className="mb-4 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm"
              />

              <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2">
                <section className="min-w-0">
                  {loading ? (
                    <div className="rounded-xl bg-white p-6 text-center text-sm text-gray-500">
                      Memuat riwayat...
                    </div>
                  ) : (
                    renderOrderList(groupedHistoryOrders, 'history')
                  )}
                </section>
                <section className="min-w-0">
                  <h2 className="mb-3 font-extrabold text-gray-900">Detail Riwayat</h2>
                  {renderHistoryDetail()}
                </section>
              </div>
            </>
          )}

          {activePage === 'laporan' && renderReport()}

          {activePage === 'meja' && renderTableStatus()}

          {activePage === 'akun' && renderCashierAccount()}
        </main>
      </div>

      {receipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-3">
          <div className="my-auto w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-gray-900">Pratinjau Struk</h2>
                <p className="text-xs text-gray-500">{receipt.order.order_code}</p>
              </div>
              <button
                type="button"
                onClick={() => setReceipt(null)}
                className="rounded-lg bg-gray-100 px-3 py-2 font-bold text-gray-600"
              >
                ×
              </button>
            </div>

            <div className="mx-auto max-h-[60vh] max-w-[280px] overflow-y-auto border border-dashed border-gray-300 bg-white p-4 text-xs text-gray-800">
              <div className="text-center">
                <p className="text-base font-extrabold">WAROENG BPJS</p>
                <p className="mt-1 leading-relaxed">
                  Jl. Kandangsapi 001/002 No. 01<br />
                  Desa Tanjungsari, Kecamatan Sukaluyu<br />
                  Kabupaten Cianjur
                </p>
              </div>

              <div className="my-3 border-t border-dashed border-gray-400" />

              <div className="space-y-1">
                <p>No: {receipt.order.order_code}</p>
                <p>Pelanggan: {receipt.order.customer_name}</p>
                <p>Meja: {String(receipt.order.table_number).padStart(2, '0')}</p>
                <p>Waktu: {formatDate(receipt.order.created_at)}</p>
              </div>

              <div className="my-3 border-t border-dashed border-gray-400" />

              {receipt.items.map((item, index) => (
                <div key={`${item.item_name}-${index}`} className="mb-3">
                  <p className="font-bold">{item.item_name}</p>
                  <div className="flex justify-between gap-2">
                    <span>{item.quantity} × {rupiah(item.item_price)}</span>
                    <span className="font-bold">{rupiah(item.subtotal)}</span>
                  </div>
                </div>
              ))}

              <div className="my-3 border-t border-dashed border-gray-400" />

              <div className="flex justify-between gap-2 text-sm font-extrabold">
                <span>TOTAL</span>
                <span>{rupiah(Number(receipt.order.total_amount || 0))}</span>
              </div>

              <p className="mt-2">
                Pembayaran: {receipt.order.payment_status === 'lunas' ? 'LUNAS' : 'BELUM LUNAS'}
              </p>
              <p>
                Metode: {receipt.order.payment_method === 'tunai'
                  ? 'Tunai'
                  : receipt.order.payment_method === 'non_tunai'
                    ? 'Non-Tunai'
                    : '-'}
              </p>

              <div className="my-3 border-t border-dashed border-gray-400" />
              <p className="text-center leading-relaxed">
                Terima kasih telah berkunjung.<br />
                Selamat menikmati pesanan Anda.
              </p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setReceipt(null)}
                className="rounded-xl border border-gray-300 px-4 py-3 text-sm font-bold text-gray-700"
              >
                Tutup
              </button>
              <button
                type="button"
                onClick={handlePrintReceipt}
                className="rounded-xl bg-green-800 px-4 py-3 text-sm font-extrabold text-white"
              >
                CETAK STRUK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

