import { signOut } from 'firebase/auth';
import { auth } from './firebase';
import StaffLogin from './components/StaffLogin';
import AdminView from './components/AdminView';
import KasirView from './components/KasirView';
import type { StaffRole } from './types';
import { useEffect, useState } from 'react';
import { listenToMenus, createOrder } from './services/firestore';
import type { MenuItem } from './types';
import Cart from './components/Cart';
import CustomerForm from './components/CustomerForm';
import OrderConfirmation from './components/OrderConfirmation';

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
  const [staffRole, setStaffRole] = useState<StaffRole | null>(null);
  const [staffName, setStaffName] = useState('');
  const [showStaffLogin, setShowStaffLogin] = useState(false);
useEffect(() => {
  localStorage.setItem(
    'waroeng_bpjs_cart',
    JSON.stringify(cart)
  );
}, [cart]);
  const handleStaffLogin = (name: string, role: StaffRole) => {
    setStaffName(name);
    setStaffRole(role);
    setShowStaffLogin(false);
  };

const handleStaffLogout = async () => {
  await signOut(auth);
  setStaffRole(null);
  setStaffName('');
};

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

    setSending(true);
    setOrderError('');

    try {
      const result = await createOrder({
        customer_name: customerName,
        table_number: tableNumber,
        items: orderItems,
        total_amount: total
      });
            setSuccessOrder({
        orderCode: result.order_code,
        name: customerName,
        table: tableNumber,
        items: [...orderItems],
        total: total
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
  if (staffRole) {
    return (
      <div>
        <div className="flex items-center justify-between bg-green-900 p-4 text-white">
          <div>
            <p className="font-bold">{staffName}</p>
            <p className="text-sm">
              {staffRole === 'admin' ? 'Administrator' : 'Kasir'}
            </p>
          </div>

          <button
            onClick={handleStaffLogout}
            className="rounded-lg bg-white px-4 py-2 font-bold text-green-900"
          >
            Keluar
          </button>
        </div>

        {staffRole === 'admin' ? <AdminView /> : <KasirView />}
      </div>
    );
  }

    if (showStaffLogin) {
  return (
    <StaffLogin
      onLogin={handleStaffLogin}
      onBack={() => setShowStaffLogin(false)}
    />
  );
    }

  return (
    <main className="min-h-screen bg-amber-50 pb-80">
    <header className="bg-green-800 px-5 py-7 text-white">
  <div className="mx-auto max-w-5xl">
        <img
      src="/logo.png"
      alt="Logo Waroeng BPJS"
      className="mb-4 h-32 w-32 object-contain"
    />

    <h1 className="text-3xl font-extrabold">
      WAROENG BPJS
    </h1>

          <p className="mt-2 text-sm text-green-100">
            Nikmat & Pas di Kantong
          </p>

          <p className="mt-4 text-sm leading-relaxed text-green-100">
            Jl. Kandangsapi 001/002 No. 01,
            Desa Tanjungsari, Kecamatan Sukaluyu,
            Kabupaten Cianjur
          </p>

          <button
            onClick={() => setShowStaffLogin(true)}
            className="mt-4 rounded-lg bg-white px-4 py-2 font-bold text-green-900"
          >
            Login Admin / Kasir
          </button>
        </div>
      </header>



      <section className="mx-auto max-w-5xl px-4 py-6">
        <h2 className="mb-4 text-xl font-bold">
          Pilihan Menu
        </h2>

        <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
          {categories.map((item) => (
            <button
              key={item.id}
              onClick={() => setCategory(item.id)}
              className={`shrink-0 rounded-full px-5 py-2 text-sm font-semibold ${
                category === item.id
                  ? 'bg-green-800 text-white'
                  : 'bg-white text-gray-700'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {loading && (
          <p className="py-10 text-center">
            Menghubungkan menu...
          </p>
        )}

        {error && (
          <div className="rounded-xl bg-red-100 p-4 text-red-800">
            {error}
          </div>
        )}

        {!loading && !error && filteredMenus.length === 0 && (
          <div className="rounded-xl bg-white p-8 text-center text-gray-600">
            Menu belum tersedia.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:gap-5">
          {filteredMenus.map((item) => (
            
<article
  key={item.id}
  className="overflow-hidden rounded-2xl bg-white shadow-md"
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

<span className="absolute left-2 top-2 rounded-lg bg-black/70 px-3 py-1 text-[10px] font-semibold text-white sm:text-xs">
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
        <p className="text-sm font-extrabold text-amber-700 sm:text-base">
          {rupiah(Number(item.price) || 0)}
        </p>
      </div>

      <button
        onClick={() => addToCart(item)}
        className="shrink-0 rounded-lg bg-orange-500 px-2 py-2 text-[10px] font-bold text-white shadow-sm hover:bg-orange-600 sm:px-3 sm:py-2"
      >
        + Pesan
      </button>
    </div>
  </div>
</article>

          ))}
        </div>

        <div className="mt-8">
          <CustomerForm onSubmit={startConfirmation} />
        </div>

        {orderError && (
          <div className="mt-4 rounded-xl bg-red-100 p-3 text-sm text-red-800">
            {orderError}
          </div>
        )}

        {successCode && (
          <div className="mt-4 rounded-xl bg-green-100 p-4 text-green-900">
            <h2 className="font-bold">
              Pesanan berhasil disimpan!
            </h2>
            <p className="mt-2">
              Kode pesanan: <strong>{successCode}</strong>
            </p>
            <p className="mt-2 text-sm">
              Silakan lakukan pembayaran di kasir.
            </p>
            <button
              onClick={() => setSuccessCode('')}
              className="mt-3 rounded-lg bg-green-800 px-4 py-2 text-white"
            >
              Tutup
            </button>
          </div>
        )}
      </section>

      <Cart
        items={cart}
        onAdd={addToCart}
        onRemove={removeFromCart}
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
