
import { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc
} from 'firebase/firestore';
import { db } from '../firebase';
import type { MenuItem } from '../types';

const rupiah = (value: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value);

export default function AdminView() {
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('makanan');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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

  const addMenu = async () => {
    if (!name.trim() || !price || Number(price) <= 0) {
      setError('Nama dan harga menu wajib diisi dengan benar.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      await addDoc(collection(db, 'menu_items'), {
        name: name.trim(),
        category,
        price: Number(price),
        description: description.trim(),
        image_url: imageUrl.trim(),
        is_available: true
      });

      setName('');
      setPrice('');
      setDescription('');
      setImageUrl('');
    } catch (err) {
      console.error(err);
      setError('Gagal menambahkan menu. Periksa hak akses Admin.');
    } finally {
      setSaving(false);
    }
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

  return (
    <main className="min-h-screen bg-amber-50 p-4">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-extrabold text-green-800">
          Admin WAROENG BPJS
        </h1>

        <p className="mt-1 text-sm text-gray-500">
          Pengelolaan produk dan harga menu
        </p>

        <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold">Tambah Menu</h2>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama produk"
            className="mb-3 w-full rounded-xl border p-3"
          />

          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="mb-3 w-full rounded-xl border p-3"
          >
            <option value="makanan">Makanan</option>
            <option value="minuman">Minuman</option>
            <option value="cemilan">Cemilan</option>
          </select>

          <input
            type="number"
            min="1"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Harga produk"
            className="mb-3 w-full rounded-xl border p-3"
          />

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Deskripsi produk"
            className="mb-3 w-full rounded-xl border p-3"
          />

          <input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="URL foto produk (opsional)"
            className="mb-3 w-full rounded-xl border p-3"
          />

          {error && (
            <p className="mb-3 rounded-lg bg-red-100 p-3 text-sm text-red-800">
              {error}
            </p>
          )}

          <button
            onClick={addMenu}
            disabled={saving}
            className="w-full rounded-xl bg-green-800 py-3 font-bold text-white"
          >
            {saving ? 'Menyimpan...' : 'Simpan Produk'}
          </button>
        </section>

        <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold">
            Daftar Produk ({menus.length})
          </h2>

          {menus.map((menu) => (
            <article
              key={menu.id}
              className="flex items-center justify-between gap-3 border-b py-4"
            >
              <div className="min-w-0">
                <p className="font-bold">{menu.name}</p>
                <p className="text-sm text-gray-500">
                  {menu.category} · {rupiah(Number(menu.price) || 0)}
                </p>
                <p className="text-xs text-gray-500">
                  {menu.is_available ? 'Tersedia' : 'Tidak tersedia'}
                </p>
              </div>

              <div className="flex shrink-0 flex-col gap-2">
                <button
                  onClick={() => toggleAvailability(menu)}
                  className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold"
                >
                  Ubah Status
                </button>

                <button
                  onClick={() => removeMenu(menu)}
                  className="rounded-lg bg-red-100 px-3 py-2 text-xs font-semibold text-red-700"
                >
                  Hapus
                </button>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
