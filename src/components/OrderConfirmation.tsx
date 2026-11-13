
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4">
      <div className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">

        <div className="shrink-0 border-b px-5 py-4">
          <h2 className="text-xl font-extrabold text-gray-800">
            Konfirmasi Pesanan
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Periksa kembali pesanan Anda sebelum dikirim.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex justify-between gap-3">
              <span className="text-sm text-gray-600">
                Nama Pemesan
              </span>
              <strong className="text-right text-sm text-gray-800">
                {name}
              </strong>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm text-gray-600">
                Nomor Meja
              </span>
              <strong className="text-lg text-gray-800">
                {String(table).padStart(2, '0')}
              </strong>
            </div>
          </div>

          <div className="mb-3 mt-5 flex items-center justify-between">
            <h3 className="font-bold text-gray-800">
              Rincian Menu
            </h3>
            <span className="text-xs text-gray-500">
              {items.length} jenis menu
            </span>
          </div>

          <div className="divide-y rounded-xl border px-3">
            {items.map((item) => (
              <div
                key={item.menu_id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold text-gray-800">
                    {item.item_name}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {item.quantity} × {rupiah(item.item_price)}
                  </p>
                </div>

                <strong className="shrink-0 text-sm text-gray-800">
                  {rupiah(item.subtotal)}
                </strong>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl bg-green-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold text-gray-800">
                Total Pembayaran
              </span>
              <span className="text-lg font-extrabold text-green-800">
                {rupiah(total)}
              </span>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3">
            <p className="text-sm font-semibold text-green-800">
              Pembayaran dilakukan langsung di kasir WAROENG BPJS.
            </p>
            <p className="mt-1 text-xs text-green-700">
              Silakan lakukan pembayaran setelah pesanan diterima oleh kasir.
            </p>
          </div>

        </div>

        <div className="shrink-0 border-t bg-white p-4">
          <button
            onClick={onConfirm}
            className="w-full rounded-xl bg-green-800 py-3 font-bold text-white shadow-sm transition-colors hover:bg-green-900"
          >
            Ya, Kirim Pesanan
          </button>

          <button
            onClick={onCancel}
            className="mt-2 w-full rounded-xl border border-gray-300 py-3 font-semibold text-gray-700 transition-colors hover:bg-gray-50"
          >
            Kembali
          </button>
        </div>

      </div>
    </div>
  );
}
