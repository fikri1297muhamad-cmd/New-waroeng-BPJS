
import { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  doc
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
    <main className="min-h-screen bg-amber-50 p-4">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-extrabold text-green-800">
          Kasir WAROENG BPJS
        </h1>

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
          {orders.map((order) => (
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
                {order.items?.map((item, index) => (
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
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
