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
const printReceipt = async (order: Order) => {
  const printWindow = window.open('', '_blank');

  if (!printWindow) {
    alert('Izinkan pop-up pada browser untuk mencetak struk.');
    return;
  }

  try {
    const itemsSnapshot = await getDocs(
      query(
        collection(db, 'order_items'),
        where('order_id', '==', order.id)
      )
    );

    const items = itemsSnapshot.docs.map((item) => item.data());

    const itemsHtml = items.map((item) => `
      <tr>
        <td colspan="2" class="item-name">
          ${item.item_name}
        </td>
      </tr>
      <tr>
        <td>
          ${item.quantity} x ${rupiah(Number(item.item_price))}
        </td>
        <td class="right">
          ${rupiah(Number(item.subtotal))}
        </td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Struk ${order.order_code}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            width: 48mm;
            margin: 0 auto;
            padding: 2mm;
            font-size: 11px;
            color: black;
          }

          h2, p {
            text-align: center;
          }

          h2 {
            font-size: 16px;
            margin-bottom: 5px;
          }

          table {
            width: 100%;
            border-collapse: collapse;
          }

          td {
            padding: 3px 0;
            vertical-align: top;
          }

          .item-name {
            font-weight: bold;
            padding-top: 7px;
          }

          .right {
            text-align: right;
            white-space: nowrap;
          }

          .line {
            border-top: 1px dashed black;
            margin: 8px 0;
          }

          .total {
            font-weight: bold;
            font-size: 14px;
          }

          @media print {
            body {
              width: 48mm;
              margin: 0 auto;
            }
          }
        </style>
      </head>

      <body>
        <h2>WAROENG BPJS</h2>

        <p>
          Jl. Kandang Sapi 001/002 No 01<br>
          Desa Tanjungsari, Sukaluyu, Cianjur
        </p>

        <div class="line"></div>

        <p style="text-align:left">
          Kode: ${order.order_code}<br>
          Nama: ${order.customer_name}<br>
          Meja: ${String(order.table_number).padStart(2, '0')}
        </p>

        <div class="line"></div>

        <table>
          ${itemsHtml || '<tr><td>Rincian makanan tidak ditemukan</td></tr>'}
        </table>

        <div class="line"></div>

        <p class="total">
          TOTAL: ${rupiah(order.total_amount)}
        </p>

        <p>
          Pembayaran: ${
            order.payment_status === 'lunas'
              ? 'LUNAS'
              : 'BELUM LUNAS'
          }
        </p>

        <div class="line"></div>

        <p>Terima kasih telah berkunjung!</p>
        <p>Selamat menikmati</p>
      </body>
      </html>
    `);

    printWindow.document.close();

    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 500);

  } catch (error) {
    console.error('Gagal mengambil rincian pesanan:', error);
    printWindow.close();
    alert('Gagal mengambil rincian makanan dari database.');
  }
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
      </div>
    </main>
  );
}
