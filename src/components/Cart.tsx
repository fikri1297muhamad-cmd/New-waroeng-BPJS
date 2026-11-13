
import type { MenuItem } from '../types';

type CartItem = {
  menu: MenuItem;
  quantity: number;
};

type Props = {
  items: CartItem[];
  onAdd: (menu: MenuItem) => void;
  onRemove: (menuId: string) => void;
};

const rupiah = (value: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value);

export default function Cart({
  items,
  onAdd,
  onRemove
}: Props) {
  const total = items.reduce(
    (sum, item) => sum + item.menu.price * item.quantity,
    0
  );

  return (
    <section className="fixed bottom-0 left-0 right-0 z-20 flex max-h-[30vh] flex-col border-t bg-white p-4 shadow-lg">
      <div className="mx-auto flex w-full min-h-0 max-w-5xl flex-1 flex-col">
        <h2 className="mb-3 shrink-0 font-bold text-gray-800">
          Keranjang Pesanan
        </h2>

        {items.length === 0 ? (
          <p className="shrink-0 text-sm text-gray-500">
            Belum ada pesanan.
          </p>
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
            {items.map((item) => (
              <div
                key={item.menu.id}
                className="flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {item.menu.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {rupiah(item.menu.price)} × {item.quantity}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <button
                    onClick={() => onRemove(item.menu.id)}
                    className="h-8 w-8 rounded-full bg-gray-100 font-bold"
                  >
                    −
                  </button>

                  <span className="font-bold">
                    {item.quantity}
                  </span>

                  <button
                    onClick={() => onAdd(item.menu)}
                    className="h-8 w-8 rounded-full bg-green-800 text-white font-bold"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex shrink-0 items-center justify-between border-t pt-3">
          <span className="font-bold">Total Pembayaran</span>
          <span className="text-lg font-extrabold text-green-800">
            {rupiah(total)}
          </span>
        </div>
      </div>
    </section>
  );
}
