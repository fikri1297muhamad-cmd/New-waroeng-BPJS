type Item = {
  menu_id: string;
  item_name: string;
  item_price: number;
  quantity: number;
  subtotal: number;
};

type Props = {
  name: string;
  table: number;
  items: Item[];
  total: number;
  onConfirm: () => void;
  onCancel: () => void;
};

const rupiah = (value: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value);

export default function OrderConfirmation({
  name,
  table,
  items,
  total,
  onConfirm,
  onCancel
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5">
        <h2 className="text-xl font-extrabold text-gray-800">
          Konfirmasi Pesanan
        </h2>

        <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm">
          <p>Nama: <strong>{name}</strong></p>
          <p>Nomor meja: <strong>{String(table).padStart(2, '0')}</strong></p>
        </div>

        <h3 className="mb-3 mt-5 font-bold">Rincian Menu</h3>

        {items.map((item) => (
          <div
            key={item.menu_id}
            className="flex justify-between gap-3 border-b py-2 text-sm"
          >
            <div>
              <p className="font-semibold">{item.item_name}</p>
              <p className="text-gray-500">
                {item.quantity} × {rupiah(item.item_price)}
              </p>
            </div>

            <strong>{rupiah(item.subtotal)}</strong>
          </div>
        ))}

        <div className="mt-4 flex justify-between text-lg font-extrabold">
          <span>Total</span>
          <span className="text-green-800">{rupiah(total)}</span>
        </div>

        <p className="mt-4 rounded-xl bg-green-50 p-3 text-sm text-green-800">
          Pembayaran dilakukan langsung di kasir WAROENG BPJS.
        </p>

        <button
          onClick={onConfirm}
          className="mt-5 w-full rounded-xl bg-green-800 py-3 font-bold text-white"
        >
          Ya, Kirim Pesanan
        </button>

        <button
          onClick={onCancel}
          className="mt-2 w-full rounded-xl border py-3 font-semibold text-gray-700"
        >
          Kembali
        </button>
      </div>
    </div>
  );
}
