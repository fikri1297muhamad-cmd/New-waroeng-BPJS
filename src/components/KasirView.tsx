import { useState, useEffect } from 'react';
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

import { db } from '../firebase';
type Order = {
  id: string;
  order_code: string;
  customer_name: string;
  table_number: number;
  items: {
    item_name: string;
    item_price: number;
    quantity: number;
    subtotal: number;
  }[];
  total_amount: number;
  status: string;
  payment_status: string;
  created_at: unknown;
};

const rupiah = (value: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value);

const statusLabels: Record<string, string> = {
  menunggu: 'Pesanan Baru',
  diproses: 'Sedang Diproses',
  siap: 'Siap Disajikan',
  selesai: 'Selesai',
  dibatalkan: 'Dibatalkan'
};




export default function KasirView() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<{
  order: Order;
  items: {
    item_name: string;
    item_price: number;
    quantity: number;
    subtotal: number;
  }[];
} | null>(null);
const printReceipt = async (order: Order) => {
  try {
    const snapshot = await getDocs(
      query(
        collection(db, 'order_items'),
        where('order_id', '==', order.id)
      )
    );

    const items = snapshot.docs.map((itemDoc) => {
      const data = itemDoc.data();

      return {
        item_name: String(data.item_name ?? ''),
        item_price: Number(data.item_price ?? 0),
        quantity: Number(data.quantity ?? 0),
        subtotal: Number(data.subtotal ?? 0),
      };
    });

    setReceipt({
      order,
      items,
    });
  } catch (error) {
  console.error('Gagal mengambil rincian pesanan:', error);

  setError(
    error instanceof Error
      ? error.message
      : String(error)
  );
}
};
  useEffect(() => {
    const ordersQuery = query(
      collection(db, 'orders'),
      orderBy('created_at', 'desc')
    );

    return onSnapshot(
      ordersQuery,
      (snapshot) => {
        setOrders(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data()
          })) as Order[]
        );
        setLoading(false);
        setError('');
      },
      (err) => {
        console.error(err);
        setError('Gagal membaca pesanan. Periksa login dan hak akses kasir.');
        setLoading(false);
      }
    );
  }, []);

  const changeStatus = async (
    orderId: string,
    status: string
  ) => {
    try {
      await updateDoc(doc(db, 'orders', orderId), {
        status
      });
    } catch (err) {
      console.error(err);
      setError('Gagal memperbarui status pesanan.');
    }
  };

  const markPaid = async (orderId: string) => {
    if (!window.confirm('Catat pembayaran sudah diterima di kasir?')) {
      return;
    }

    try {
      await updateDoc(doc(db, 'orders', orderId), {
        payment_status: 'lunas'
      });
    } catch (err) {
      console.error(err);
      setError('Gagal mencatat pembayaran.');
    }
  };

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
        }

        .no-print {
          display: none !important;
        }
      }
    `}</style>

    <main className="min-h-screen bg-amber-50 p-4">
  <div className="mx-auto max-w-4xl">

    <p className="mt-1 text-sm text-gray-500">
          Daftar pesanan pelanggan
        </p>

        {loading && (
          <p className="mt-6 text-center">
            Memuat pesanan...
          </p>
        )}

        {error && (
          <p className="mt-4 rounded-xl bg-red-100 p-3 text-sm text-red-800">
            {error}
          </p>
        )}

        {!loading && !error && orders.length === 0 && (
          <div className="mt-6 rounded-2xl bg-white p-8 text-center text-gray-500">
            Belum ada pesanan masuk.
          </div>
        )}

        <div className="mt-6 space-y-4">
          {orders.map((order: Order) => (
            <article
              key={order.id}
              className="rounded-2xl bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-extrabold text-gray-800">
                    {order.order_code}
                  </h2>

                  <p className="mt-1 text-sm text-gray-600">
                    {order.customer_name}
                  </p>

                  <p className="text-sm text-gray-600">
                    Meja {String(order.table_number).padStart(2, '0')}
                  </p>
                </div>

                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold">
                  {statusLabels[order.status] || order.status}
                </span>
              </div>

              <div className="my-4 border-t pt-3">
                {order.items?.map((item: Order['items'][number], index: number) => (
                  <div
                    key={index}
                    className="flex justify-between gap-3 py-1 text-sm"
                  >
                    <span>
                      {item.item_name} × {item.quantity}
                    </span>
                    <span>{rupiah(item.subtotal)}</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-between border-t pt-3 font-extrabold">
                <span>Total</span>
                <span className="text-green-800">
                  {rupiah(order.total_amount)}
                </span>
              </div>

              <p className="mt-3 text-sm">
                Pembayaran:{' '}
                <strong>
                  {order.payment_status === 'lunas'
                    ? 'LUNAS'
                    : 'BELUM LUNAS'}
                </strong>
              </p>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={() => changeStatus(order.id, 'diproses')}
                  disabled={['selesai', 'dibatalkan'].includes(order.status)}
                  className="rounded-lg bg-blue-100 p-2 text-sm font-semibold"
                >
                  Proses
                </button>

                <button
                  onClick={() => changeStatus(order.id, 'siap')}
                  disabled={['selesai', 'dibatalkan'].includes(order.status)}
                  className="rounded-lg bg-amber-100 p-2 text-sm font-semibold"
                >
                  Siap
                </button>

                <button
                  onClick={() => changeStatus(order.id, 'selesai')}
                  disabled={order.status === 'dibatalkan'}
                  className="rounded-lg bg-green-100 p-2 text-sm font-semibold"
                >
                  Selesai
                </button>

                <button
                  onClick={() => markPaid(order.id)}
                  disabled={order.payment_status === 'lunas'}
                  className="rounded-lg bg-green-800 p-2 text-sm font-semibold text-white"
                >
                  {order.payment_status === 'lunas'
                    ? 'Sudah Lunas'
                    : 'Catat LUNAS'}
                </button>
              </div>
              <button
  onClick={() => printReceipt(order)}
  className="mt-3 w-full rounded-lg bg-gray-800 p-3 text-sm font-bold text-white"
>
  CETAK STRUK
</button>
            </article>
          ))}
                </div>

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
                  Jl Kandang Sapi 001/002 No 01
                </p>
                <p className="text-xs">
                  Desa Tanjungsari, Cianjur
                </p>
                <hr className="my-3" />
                <h3 className="font-bold">STRUK PESANAN</h3>
              </div>

              <div className="my-3 text-sm">
                <p>No: {receipt.order.order_code}</p>
                <p>Nama: {receipt.order.customer_name}</p>
                <p>
                  Meja: {String(receipt.order.table_number).padStart(2, '0')}
                </p>
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

              <p className="text-center text-sm">
                Pembayaran: {receipt.order.payment_status === 'lunas' ? 'LUNAS' : 'BELUM LUNAS'}
              </p>

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
  </div>
    </main>
  </>
  );
}
