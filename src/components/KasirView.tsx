
import { useState, useEffect, useMemo, useRef } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  doc,
  where,
  getDocs
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
};

const cashierNavigation: {
  id: CashierPage;
  label: string;
  icon: string;
  description: string;
}[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: '▦',
    description: 'Ringkasan dan pengelolaan pesanan.'
  },
  {
    id: 'pesanan',
    label: 'Pesanan Aktif',
    icon: '▤',
    description: 'Pengelolaan pesanan yang masih berjalan.'
  },
  {
    id: 'riwayat',
    label: 'Riwayat Pesanan',
    icon: '◷',
    description: 'Daftar pesanan selesai dan dibatalkan.'
  },
  {
    id: 'laporan',
    label: 'Laporan Kas',
    icon: 'Rp',
    description: 'Rekap pemasukan dan transaksi kasir.'
  },
  {
    id: 'meja',
    label: 'Status Meja',
    icon: '▦',
    description: 'Pemantauan kondisi seluruh meja.'
  },
  {
    id: 'akun',
    label: 'Akun Kasir',
    icon: '♙',
    description: 'Profil dan aktivitas akun kasir.'
  }
];

const rupiah = (value: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value);

const statusLabels: Record<string, string> = {
  menunggu: 'Pesanan Baru',
  diproses: 'Diproses',
  siap: 'Siap Disajikan',
  selesai: 'Selesai',
  dibatalkan: 'Dibatalkan'
};

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

  if (key === getTodayWibKey()) {
    return 'Hari Ini';
  }

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

function statusColor(status: string) {
  switch (status) {
    case 'menunggu':
      return 'bg-amber-100 text-amber-800';
    case 'diproses':
      return 'bg-blue-100 text-blue-800';
    case 'siap':
      return 'bg-emerald-100 text-emerald-800';
    case 'selesai':
      return 'bg-gray-100 text-gray-700';
    case 'dibatalkan':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export default function KasirView() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [activePage, setActivePage] =
    useState<CashierPage>('dashboard');

  const activePageInfo = cashierNavigation.find(
    item => item.id === activePage
  );

  const [search, setSearch] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [showDetail, setShowDetail] = useState(true);

  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});

  const [detailItems, setDetailItems] = useState<OrderItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>('tunai');

  const [processingPayment, setProcessingPayment] = useState(false);
  const [processingStatus, setProcessingStatus] = useState(false);

  const detailRef = useRef<HTMLDivElement>(null);

  const [receipt, setReceipt] = useState<{
    order: Order;
    items: OrderItem[];
  } | null>(null);

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
        setError(
          'Gagal membaca pesanan. Periksa login dan hak akses kasir.'
        );
        setLoading(false);
      }
    );
  }, []);

  const selectedOrder = orders.find(
    order => order.id === selectedOrderId
  ) ?? null;

  const summary = useMemo(() => {
    const paidOrders = orders.filter(
      order => order.payment_status === 'lunas'
    );

    const unpaidOrders = orders.filter(
      order => order.payment_status === 'belum_lunas'
    );

    const totalIncome = paidOrders.reduce(
      (sum, order) => sum + Number(order.total_amount || 0),
      0
    );

    const cashIncome = paidOrders
      .filter(order => order.payment_method === 'tunai')
      .reduce(
        (sum, order) => sum + Number(order.total_amount || 0),
        0
      );

    const nonCashIncome = paidOrders
      .filter(order => order.payment_method === 'non_tunai')
      .reduce(
        (sum, order) => sum + Number(order.total_amount || 0),
        0
      );

    const unpaidAmount = unpaidOrders.reduce(
      (sum, order) => sum + Number(order.total_amount || 0),
      0
    );

    return {
      totalOrders: orders.length,
      paidCount: paidOrders.length,
      unpaidCount: unpaidOrders.length,
      processingCount: orders.filter(
        order => order.status === 'diproses'
      ).length,
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
      String(order.order_code || '')
        .toLowerCase()
        .includes(keyword) ||
      String(order.customer_name || '')
        .toLowerCase()
        .includes(keyword)
    );
  }, [orders, search]);

  const groupedOrders = useMemo(() => {
    const groups: Record<string, Order[]> = {};

    filteredOrders.forEach(order => {
      const key = getWibDateKey(order.created_at);

      if (!groups[key]) {
        groups[key] = [];
      }

      groups[key].push(order);
    });

    return Object.entries(groups).sort(([a], [b]) => {
      if (a === 'tanggal-tidak-diketahui') return 1;
      if (b === 'tanggal-tidak-diketahui') return -1;
      return b.localeCompare(a);
    });
  }, [filteredOrders]);

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

        if (active) {
          setDetailItems(items);
        }
      } catch (err) {
        console.error('Gagal mengambil rincian pesanan:', err);

        if (active) {
          setError(
            'Rincian pesanan gagal dimuat. Silakan pilih pesanan kembali.'
          );
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

  const toggleGroup = (key: string) => {
    setCollapsedGroups(previous => ({
      ...previous,
      [key]: !previous[key]
    }));
  };

  const changeStatus = async (
    orderId: string,
    status: string
  ) => {
    if (processingStatus) return;

    setProcessingStatus(true);
    setError('');

    try {
      await updateDoc(doc(db, 'orders', orderId), {
        status
      });
    } catch (err) {
      console.error('Gagal memperbarui status:', err);
      setError('Gagal memperbarui status pesanan.');
    } finally {
      setProcessingStatus(false);
    }
  };

  const markPaid = async (order: Order) => {
    if (processingPayment) return;

    if (order.payment_status === 'lunas') {
      setError('Pesanan ini sudah lunas.');
      return;
    }

    const methodLabel =
      paymentMethod === 'tunai' ? 'TUNAI' : 'NON-TUNAI';

    const confirmed = window.confirm(
      `Konfirmasi pembayaran ${methodLabel} sebesar ${rupiah(
        order.total_amount
      )} untuk pesanan ${order.order_code}?`
    );

    if (!confirmed) return;

    setProcessingPayment(true);
    setError('');

    try {
      const currentUser = auth.currentUser;

      if (!currentUser) {
        throw new Error('Sesi login berakhir. Silakan login kembali.');
      }

      const idToken = await currentUser.getIdToken();

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
        throw new Error(
          result.error || 'Pembayaran gagal dicatat.'
        );
      }

      setError('');
    } catch (err) {
      console.error('Gagal mencatat pembayaran:', err);

      setError(
        err instanceof Error
          ? err.message
          : 'Pembayaran gagal dicatat.'
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

  const renderOrderList = () => (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-extrabold text-gray-900">
            Pesanan Masuk
          </h2>
          <p className="text-xs text-gray-500">
            Pilih pesanan untuk melihat detail
          </p>
        </div>

        <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800">
          {filteredOrders.length} Pesanan
        </span>
      </div>

      <input
        type="search"
        value={search}
        onChange={event => setSearch(event.target.value)}
        placeholder="Cari nomor pesanan atau nama pelanggan..."
        className="mb-4 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none focus:border-green-600 focus:bg-white"
      />

      {loading ? (
        <div className="py-10 text-center text-sm text-gray-500">
          Memuat pesanan...
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="rounded-xl bg-gray-50 p-8 text-center text-sm text-gray-500">
          {search
            ? 'Pesanan tidak ditemukan.'
            : 'Belum ada pesanan masuk.'}
        </div>
      ) : (
        <div className="max-h-[750px] space-y-4 overflow-y-auto pr-1">
          {groupedOrders.map(([dateKey, dateOrders]) => {
            const isToday = dateKey === getTodayWibKey();
            const isSearching = Boolean(search.trim());

            const isCollapsed = isSearching
              ? false
              : collapsedGroups[dateKey] ?? !isToday;

            return (
              <div
                key={dateKey}
                className="overflow-hidden rounded-xl border border-gray-200"
              >
                <button
                  type="button"
                  onClick={() => toggleGroup(dateKey)}
                  className="flex w-full items-center justify-between gap-3 bg-gray-50 px-3 py-3 text-left hover:bg-green-50"
                >
                  <div>
                    <p className="text-sm font-extrabold text-gray-800">
                      {formatGroupDate(dateKey)}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {dateOrders.length} pesanan
                    </p>
                  </div>

                  <span className="text-lg font-bold text-green-800">
                    {isCollapsed ? '+' : '−'}
                  </span>
                </button>

                {!isCollapsed && (
                  <div className="space-y-2 p-2">
                    {dateOrders.map(order => (
                      <button
                        key={order.id}
                        type="button"
                        onClick={() => {
                          setSelectedOrderId(order.id);
                          setPaymentMethod('tunai');
                          setShowDetail(true);
                          setError('');
                        }}
                        className={`w-full rounded-xl border p-3 text-left transition ${
                          selectedOrderId === order.id && showDetail
                            ? 'border-green-600 bg-green-50'
                            : 'border-gray-100 bg-white hover:border-green-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-extrabold text-gray-900">
                              {order.order_code}
                            </p>
                            <p className="mt-1 truncate text-sm text-gray-700">
                              {order.customer_name}
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
                              Meja {String(order.table_number).padStart(2, '0')}
                            </p>
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusColor(order.status)}`}>
                              {statusLabels[order.status] || order.status}
                            </span>

                            <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                              order.payment_status === 'lunas'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}>
                              {order.payment_status === 'lunas'
                                ? 'LUNAS'
                                : 'BELUM LUNAS'}
                            </span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderOrderDetail = () => (
    <div
      ref={detailRef}
      className="scroll-mt-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm xl:col-span-2"
    >
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-gray-900">
            Detail Pesanan
          </h2>
          <p className="text-xs text-gray-500">
            Informasi lengkap pesanan yang dipilih
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowDetail(false)}
          aria-label="Tutup detail pesanan"
          title="Sembunyikan detail"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xl font-bold text-gray-600 hover:bg-red-100 hover:text-red-700"
        >
          ×
        </button>
      </div>

      <div className="mt-4">
        {!selectedOrder ? (
          <div className="rounded-xl bg-gray-50 p-8 text-center text-sm text-gray-500">
            Pilih salah satu nomor pesanan untuk melihat detail.
          </div>
        ) : (
          <>
            <div className="space-y-2 rounded-xl bg-gray-50 p-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-gray-500">Nomor</span>
                <strong className="text-right">
                  {selectedOrder.order_code}
                </strong>
              </div>

              <div className="flex justify-between gap-2">
                <span className="text-gray-500">Pelanggan</span>
                <strong className="text-right">
                  {selectedOrder.customer_name}
                </strong>
              </div>

              <div className="flex justify-between gap-2">
                <span className="text-gray-500">Meja</span>
                <strong>
                  {String(selectedOrder.table_number).padStart(2, '0')}
                </strong>
              </div>

              <div className="flex justify-between gap-2">
                <span className="text-gray-500">Waktu (WIB)</span>
                <strong className="text-right text-xs">
                  {formatDate(selectedOrder.created_at)}
                </strong>
              </div>
            </div>

            <div className="my-4">
              <h3 className="mb-3 text-sm font-extrabold">
                Rincian Menu
              </h3>

              {detailLoading ? (
                <p className="py-5 text-center text-sm text-gray-500">
                  Memuat rincian...
                </p>
              ) : detailItems.length === 0 ? (
                <p className="rounded-lg bg-gray-50 p-4 text-center text-xs text-gray-500">
                  Rincian menu tidak tersedia.
                </p>
              ) : (
                <div className="max-h-60 space-y-3 overflow-y-auto">
                  {detailItems.map((item, index) => (
                    <div
                      key={index}
                      className="border-b border-gray-100 pb-2"
                    >
                      <div className="flex justify-between gap-2 text-sm">
                        <span className="font-semibold">
                          {item.item_name}
                        </span>
                        <span className="font-bold">
                          {rupiah(item.subtotal)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {item.quantity} × {rupiah(item.item_price)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-between border-t-2 border-gray-200 py-3 font-extrabold">
              <span>TOTAL</span>
              <span className="text-green-900">
                {rupiah(selectedOrder.total_amount)}
              </span>
            </div>

            <div className="mb-4 rounded-xl bg-gray-50 p-3">
              <p className="text-xs text-gray-500">
                STATUS PEMBAYARAN
              </p>
              <p className={`mt-1 font-extrabold ${
                selectedOrder.payment_status === 'lunas'
                  ? 'text-green-700'
                  : 'text-amber-700'
              }`}>
                {selectedOrder.payment_status === 'lunas'
                  ? 'SUDAH LUNAS'
                  : 'BELUM LUNAS'}
              </p>

              {selectedOrder.payment_status === 'lunas' &&
                selectedOrder.payment_method && (
                  <p className="mt-1 text-xs text-gray-500">
                    Metode: {selectedOrder.payment_method === 'tunai'
                      ? 'Tunai'
                      : 'Non-Tunai'}
                  </p>
                )}
            </div>

            <div className="mb-4">
              <p className="mb-2 text-xs font-bold text-gray-600">
                METODE PEMBAYARAN
              </p>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('tunai')}
                  disabled={selectedOrder.payment_status === 'lunas'}
                  className={`rounded-lg border p-3 text-sm font-bold ${
                    paymentMethod === 'tunai'
                      ? 'border-green-700 bg-green-100 text-green-900'
                      : 'border-gray-200 bg-white text-gray-600'
                  } disabled:opacity-50`}
                >
                  Tunai
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod('non_tunai')}
                  disabled={selectedOrder.payment_status === 'lunas'}
                  className={`rounded-lg border p-3 text-sm font-bold ${
                    paymentMethod === 'non_tunai'
                      ? 'border-green-700 bg-green-100 text-green-900'
                      : 'border-gray-200 bg-white text-gray-600'
                  } disabled:opacity-50`}
                >
                  Non-Tunai
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => markPaid(selectedOrder)}
              disabled={
                selectedOrder.payment_status === 'lunas' ||
                processingPayment ||
                detailLoading
              }
              className="w-full rounded-xl bg-green-800 p-3 font-extrabold text-white shadow-sm hover:bg-green-900 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {processingPayment
                ? 'MENCATAT PEMBAYARAN...'
                : selectedOrder.payment_status === 'lunas'
                  ? 'SUDAH LUNAS'
                  : 'CATAT LUNAS'}
            </button>

            <button
              type="button"
              onClick={() => printReceipt(selectedOrder)}
              className="mt-2 w-full rounded-xl bg-gray-800 p-3 text-sm font-bold text-white hover:bg-gray-900"
            >
              CETAK STRUK
            </button>

            <div className="mt-4 border-t border-gray-100 pt-4">
              <p className="mb-2 text-xs font-bold text-gray-600">
                STATUS PESANAN
              </p>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => changeStatus(selectedOrder.id, 'diproses')}
                  disabled={
                    processingStatus ||
                    ['selesai', 'dibatalkan', 'diproses'].includes(selectedOrder.status)
                  }
                  className="rounded-lg bg-blue-100 p-2 text-xs font-bold text-blue-800 disabled:opacity-40"
                >
                  Proses
                </button>

                <button
                  type="button"
                  onClick={() => changeStatus(selectedOrder.id, 'siap')}
                  disabled={
                    processingStatus ||
                    ['selesai', 'dibatalkan', 'siap'].includes(selectedOrder.status)
                  }
                  className="rounded-lg bg-amber-100 p-2 text-xs font-bold text-amber-800 disabled:opacity-40"
                >
                  Siap
                </button>

                <button
                  type="button"
                  onClick={() => changeStatus(selectedOrder.id, 'selesai')}
                  disabled={
                    processingStatus ||
                    ['selesai', 'dibatalkan'].includes(selectedOrder.status)
                  }
                  className="col-span-2 rounded-lg bg-emerald-100 p-2 text-xs font-bold text-emerald-800 disabled:opacity-40"
                >
                  Selesai
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }

          #receipt-print-area,
          #receipt-print-area * {
            visibility: visible !important;
          }

          #receipt-print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 75mm !important;
            max-width: 75mm !important;
            margin: 0 !important;
            padding: 5mm !important;
            box-shadow: none !important;
            background: white !important;
          }

          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <main className="min-h-screen bg-slate-50 text-gray-800">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 p-3 sm:p-5 lg:flex-row">

          <aside className="w-full shrink-0 rounded-2xl bg-green-900 p-4 text-white shadow-lg lg:w-60">
            <div className="mb-5 border-b border-green-700 pb-4">
              <p className="text-xs font-semibold tracking-widest text-green-200">
                WAROENG BPJS
              </p>
              <h2 className="mt-1 text-xl font-extrabold">
                KASIR
              </h2>
              <p className="mt-1 text-xs text-green-200">
                Dashboard Pengelolaan Pesanan
              </p>
            </div>

            <nav className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
              {cashierNavigation.map(item => {
                const isActive = activePage === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActivePage(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center gap-2 rounded-xl px-3 py-3 text-left text-sm font-bold transition ${
                      isActive
                        ? 'bg-white text-green-900 shadow-sm'
                        : 'text-green-100 hover:bg-green-800'
                    }`}
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="mt-6 hidden rounded-xl bg-green-800 p-3 text-xs leading-relaxed text-green-100 lg:block">
              Sistem kasir WAROENG BPJS
              <br />
              Data pesanan tersinkron dengan database.
            </div>
          </aside>

          <section className="min-w-0 flex-1">
            {activePage === 'dashboard' ? (
              <>
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h1 className="text-2xl font-extrabold text-green-950">
                      Dashboard Kasir
                    </h1>
                    <p className="mt-1 text-sm text-gray-500">
                      Ringkasan dan pengelolaan pesanan pelanggan
                    </p>
                  </div>

                  <div className="rounded-xl border border-green-100 bg-white px-4 py-2 text-sm font-semibold text-green-900">
                    <span className="mr-2 inline-block h-2 w-2 rounded-full bg-green-500" />
                    Sistem Terhubung
                  </div>
                </div>

                {error && (
                  <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    {error}
                    <button
                      onClick={() => setError('')}
                      className="ml-3 font-bold underline"
                    >
                      Tutup
                    </button>
                  </div>
                )}

                <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
                  <div className="rounded-2xl border border-green-100 bg-white p-4 shadow-sm">
                    <p className="text-xs font-semibold text-gray-500">
                      TOTAL PESANAN
                    </p>
                    <p className="mt-2 text-2xl font-extrabold text-green-950">
                      {summary.totalOrders}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      Semua pesanan
                    </p>
                  </div>

                  <div className="rounded-2xl border border-amber-100 bg-white p-4 shadow-sm">
                    <p className="text-xs font-semibold text-gray-500">
                      BELUM LUNAS
                    </p>
                    <p className="mt-2 text-2xl font-extrabold text-amber-700">
                      {summary.unpaidCount}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {rupiah(summary.unpaidAmount)}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
                    <p className="text-xs font-semibold text-gray-500">
                      PESANAN LUNAS
                    </p>
                    <p className="mt-2 text-2xl font-extrabold text-blue-800">
                      {summary.paidCount}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      Pembayaran berhasil
                    </p>
                  </div>

                  <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
                    <p className="text-xs font-semibold text-gray-500">
                      SEDANG DIPROSES
                    </p>
                    <p className="mt-2 text-2xl font-extrabold text-emerald-800">
                      {summary.processingCount}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      Pesanan aktif
                    </p>
                  </div>
                </div>

                <div className="mb-5 rounded-2xl bg-green-900 p-4 text-white shadow-md sm:p-5">
                  <div className="mb-4">
                    <h2 className="text-lg font-extrabold">
                      Ringkasan Kas
                    </h2>
                    <p className="text-xs text-green-200">
                      Dihitung dari pesanan yang sudah LUNAS
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-green-200">
                        TOTAL PEMASUKAN
                      </p>
                      <p className="mt-1 text-xl font-extrabold">
                        {rupiah(summary.totalIncome)}
                      </p>
                    </div>

                    <div className="border-t border-green-700 pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                      <p className="text-xs text-green-200">
                        TUNAI
                      </p>
                      <p className="mt-1 text-xl font-extrabold">
                        {rupiah(summary.cashIncome)}
                      </p>
                    </div>

                    <div className="border-t border-green-700 pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                      <p className="text-xs text-green-200">
                        NON-TUNAI
                      </p>
                      <p className="mt-1 text-xl font-extrabold">
                        {rupiah(summary.nonCashIncome)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className={`grid grid-cols-1 gap-5 ${showDetail ? 'xl:grid-cols-5' : 'xl:grid-cols-1'}`}>
                  {showDetail && (
                    <div className="order-1 xl:order-2">
                      {renderOrderDetail()}
                    </div>
                  )}

                  <div className={`order-2 ${showDetail ? 'xl:order-1 xl:col-span-3' : 'xl:col-span-1'}`}>
                    {renderOrderList()}
                  </div>
                </div>

                <p className="mt-5 text-center text-xs text-gray-400">
                  WAROENG BPJS · Dashboard Kasir
                </p>
              </>
            ) : (
              <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 text-xl font-extrabold text-green-900">
                    {activePageInfo?.icon}
                  </div>

                  <div>
                    <h1 className="text-xl font-extrabold text-green-950">
                      {activePageInfo?.label}
                    </h1>
                    <p className="mt-1 text-sm text-gray-500">
                      {activePageInfo?.description}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-green-100 bg-green-50 p-4">
                  <p className="font-bold text-green-900">
                    Halaman sedang disiapkan
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-green-800">
                    Navigasi ini sudah aktif. Fitur dan tampilan halaman
                    akan dibuat pada tahap berikutnya agar tidak mengganggu
                    Dashboard dan fungsi kasir yang sudah berjalan.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setActivePage('dashboard')}
                  className="mt-5 rounded-xl bg-green-800 px-5 py-3 text-sm font-bold text-white hover:bg-green-900"
                >
                  Kembali ke Dashboard
                </button>
              </div>
            )}
          </section>
        </div>
      </main>

      {receipt && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 p-4">
          <div
            id="receipt-print-area"
            className="mx-auto max-w-sm rounded-xl bg-white p-5 text-gray-900"
          >
            <div className="text-center">
              <h2 className="text-xl font-extrabold">
                WAROENG BPJS
              </h2>
              <p className="text-xs">
                Jl. Kandangsapi 001/002 No. 01
              </p>
              <p className="text-xs">
                Desa Tanjungsari, Kecamatan Sukaluyu
              </p>
              <p className="text-xs">
                Kabupaten Cianjur
              </p>
              <hr className="my-3" />
              <h3 className="font-bold">STRUK PESANAN</h3>
            </div>

            <div className="my-3 space-y-1 text-sm">
              <p>No: {receipt.order.order_code}</p>
              <p>Nama: {receipt.order.customer_name}</p>
              <p>
                Meja: {String(receipt.order.table_number).padStart(2, '0')}
              </p>
              <p>Waktu: {formatDate(receipt.order.created_at)}</p>
            </div>

            <hr />

            <div className="my-3 space-y-2 text-sm">
              {receipt.items.map((item, index) => (
                <div key={index} className="flex justify-between gap-2">
                  <span>
                    {item.item_name} × {item.quantity}
                  </span>
                  <span>{rupiah(item.subtotal)}</span>
                </div>
              ))}
            </div>

            <hr />

            <div className="flex justify-between py-3 font-extrabold">
              <span>TOTAL</span>
              <span>{rupiah(receipt.order.total_amount)}</span>
            </div>

            <div className="text-center text-sm">
              <p>
                Pembayaran:{' '}
                {receipt.order.payment_status === 'lunas'
                  ? 'LUNAS'
                  : 'BELUM LUNAS'}
              </p>

              {receipt.order.payment_method && (
                <p className="text-xs">
                  Metode: {receipt.order.payment_method === 'tunai'
                    ? 'Tunai'
                    : 'Non-Tunai'}
                </p>
              )}
            </div>

            <p className="mt-4 text-center text-sm">
              Terima kasih telah berkunjung!
              <br />
              Selamat menikmati
            </p>

            <div className="no-print mt-5 space-y-2">
              <button
                onClick={() => window.print()}
                className="w-full rounded-lg bg-green-800 p-3 font-bold text-white"
              >
                CETAK / SIMPAN PDF
              </button>

              <button
                onClick={() => setReceipt(null)}
                className="w-full rounded-lg bg-gray-200 p-3 font-bold"
              >
                TUTUP
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
