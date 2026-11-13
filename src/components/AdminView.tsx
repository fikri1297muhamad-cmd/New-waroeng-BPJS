
import { useEffect, useState, type ChangeEvent } from 'react';
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc
} from 'firebase/firestore';
import { db } from '../firebase';
import { getAuth } from 'firebase/auth';
import type { MenuItem } from '../types';
import QRCode from 'qrcode';

const rupiah = (value: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value);

type TableQrItem = {
  tableNumber: number;
  tableName: string;
  token: string;
  imageUrl: string;
};

type GeneratedQrResponse = {
  success: boolean;
  created: number;
  recovered: number;
  qrTokens: {
    tableNumber: number;
    token: string;
  }[];
  error?: string;
};

export default function AdminView() {
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('makanan');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [seedingTables, setSeedingTables] = useState(false);
  const [seedMessage, setSeedMessage] = useState('');
  const [editingMenu, setEditingMenu] = useState<MenuItem | null>(null);
  const [existingImageUrl, setExistingImageUrl] = useState('');

  // State pengelolaan QR meja
  const [qrItems, setQrItems] = useState<TableQrItem[]>([]);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrMessage, setQrMessage] = useState('');

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

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl('');
      return;
    }

    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  const handlePhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('File harus berupa foto.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Ukuran foto maksimal 5 MB.');
      return;
    }

    setError('');
    setSelectedFile(file);
  };

  const seedRestaurantTables = async () => {
    setSeedingTables(true);
    setSeedMessage('');

    try {
      const user = getAuth().currentUser;

      if (!user) {
        throw new Error('Silakan login sebagai Admin terlebih dahulu.');
      }

      const token = await user.getIdToken(true);

      const response = await fetch('/api/seed-tables', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Gagal menyiapkan meja.');
      }

      setSeedMessage(
        `Berhasil! ${result.created} meja dibuat. ${result.alreadyExists} meja sudah tersedia.`
      );
    } catch (err) {
      setSeedMessage(
        err instanceof Error ? err.message : 'Gagal menyiapkan meja.'
      );
    } finally {
      setSeedingTables(false);
    }
  };

  // Membuat atau memulihkan 50 QR meja
  const generateTableQrs = async () => {
    setQrLoading(true);
    setQrMessage('');
    setQrItems([]);

    try {
      const user = getAuth().currentUser;

      if (!user) {
        throw new Error('Silakan login sebagai Admin.');
      }

      const idToken = await user.getIdToken(true);

      const response = await fetch('/api/generate-table-qr', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        cache: 'no-store'
      });

      const result =
        (await response.json()) as GeneratedQrResponse;

      if (!response.ok || result.success !== true) {
        throw new Error(
          result.error || 'Gagal menyiapkan QR meja.'
        );
      }

      if (
        !Array.isArray(result.qrTokens) ||
        result.qrTokens.length !== 50
      ) {
        throw new Error('Data 50 QR tidak lengkap.');
      }

      const numbers = new Set<number>();
      const tokens = new Set<string>();

      for (const item of result.qrTokens) {
        if (
          !Number.isInteger(item.tableNumber) ||
          item.tableNumber < 1 ||
          item.tableNumber > 50 ||
          typeof item.token !== 'string' ||
          !/^[A-Za-z0-9_-]{43}$/.test(item.token) ||
          numbers.has(item.tableNumber) ||
          tokens.has(item.token)
        ) {
          throw new Error('Data QR tidak valid atau tidak unik.');
        }

        numbers.add(item.tableNumber);
        tokens.add(item.token);
      }

      if (numbers.size !== 50 || tokens.size !== 50) {
        throw new Error('50 QR harus memiliki nomor dan token unik.');
      }

      const sortedTokens = [...result.qrTokens].sort(
        (a, b) => a.tableNumber - b.tableNumber
      );

      const generatedItems = await Promise.all(
        sortedTokens.map(async (item) => {
          const tableCode = String(item.tableNumber).padStart(2, '0');
          const tableName = `Meja ${tableCode}`;

          const qrUrl =
            `https://new-waroeng-bpjs.vercel.app/?table=${tableCode}&token=${item.token}`;

          const imageUrl = await QRCode.toDataURL(qrUrl, {
            errorCorrectionLevel: 'H',
            margin: 2,
            width: 320
          });

          return {
            tableNumber: item.tableNumber,
            tableName,
            token: item.token,
            imageUrl
          };
        })
      );

      setQrItems(generatedItems);

      const created =
        Number.isInteger(result.created) && result.created >= 0
          ? result.created
          : 0;

      const recovered =
        Number.isInteger(result.recovered) && result.recovered >= 0
          ? result.recovered
          : 0;

      setQrMessage(
        `Berhasil! ${created} QR baru dibuat dan ${recovered} QR lama dipulihkan.`
      );
    } catch (err) {
      console.error(err);

      setQrItems([]);

      setQrMessage(
        err instanceof Error
          ? err.message
          : 'Gagal membuat QR meja.'
      );
    } finally {
      setQrLoading(false);
    }
  };

  // Mencetak 50 label QR
  const printTableQrs = () => {
    if (qrItems.length !== 50) {
      setQrMessage('Pastikan seluruh 50 QR sudah tersedia.');
      return;
    }

    const printWindow = window.open(
      '',
      '_blank',
      'width=1000,height=800'
    );

    if (!printWindow) {
      setQrMessage(
        'Jendela cetak diblokir. Izinkan pop-up pada browser.'
      );
      return;
    }

    const cards = qrItems.map((item) => `
      <article class="qr-card">
        <div class="brand">WAROENG BPJS</div>
        <div class="address">
          Jl Kandang Sapi 001/002 No 01 Desa Tanjungsari
          Kecamatan Sukaluyu Kabupaten Cianjur
        </div>
        <div class="scan">SCAN QR UNTUK MEMESAN</div>
        <div class="table-number">${item.tableName}</div>
        <img src="${item.imageUrl}" alt="${item.tableName}" />
        <div class="instruction">
          Pindai QR ini untuk memesan makanan dan minuman.
        </div>
      </article>
    `).join('');

    printWindow.document.open();

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>QR Meja WAROENG BPJS</title>
        <style>
          @page {
            size: A4;
            margin: 8mm;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            font-family: Arial, sans-serif;
            color: #111;
          }

          .grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 7mm;
          }

          .qr-card {
            border: 1px solid #333;
            border-radius: 8px;
            padding: 5mm 3mm;
            text-align: center;
            break-inside: avoid;
            page-break-inside: avoid;
            min-height: 65mm;
          }

          .brand {
            font-size: 12px;
            font-weight: 800;
          }

          .address {
            font-size: 7px;
            margin-top: 3px;
          }

          .scan {
            font-size: 10px;
            font-weight: 800;
            margin-top: 8px;
            white-space: nowrap;
          }

          .table-number {
            font-size: 21px;
            font-weight: 900;
            margin: 5px 0;
          }

          img {
            display: block;
            width: 38mm;
            height: 38mm;
            object-fit: contain;
            margin: 0 auto;
          }

          .instruction {
            font-size: 8px;
            margin-top: 5px;
          }

          @media screen {
            body {
              padding: 15px;
            }
          }
        </style>
      </head>
      <body>
        <div class="grid">${cards}</div>

        <script>
          window.onload = function() {
            setTimeout(function() {
              window.focus();
              window.print();
            }, 700);
          };
        </script>
      </body>
      </html>
    `);

    printWindow.document.close();
  };

  const addMenu = async () => {
    if (!name.trim() || !price || Number(price) <= 0) {
      setError('Nama dan harga menu wajib diisi dengan benar.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      let imageUrl = editingMenu
        ? existingImageUrl
        : '';

      if (selectedFile) {
        const formData = new FormData();

        formData.append('file', selectedFile);
        formData.append('upload_preset', 'waroeng_bpjs');

        const response = await fetch(
          'https://api.cloudinary.com/v1_1/irwzbli5/image/upload',
          {
            method: 'POST',
            body: formData
          }
        );

        const responseText = await response.text();
        let result: any;

        try {
          result = JSON.parse(responseText);
        } catch {
          throw new Error('Respons Cloudinary tidak valid.');
        }

        if (!response.ok || !result.secure_url) {
          throw new Error(
            result.error?.message || 'Gagal mengunggah foto.'
          );
        }

        imageUrl = result.secure_url;
      }

      const productData = {
        name: name.trim(),
        category,
        price: Number(price),
        description: description.trim(),
        image_url: imageUrl
      };

      if (editingMenu) {
        await updateDoc(
          doc(db, 'menu_items', editingMenu.id),
          productData
        );

        alert('Produk berhasil diperbarui!');
      } else {
        await addDoc(collection(db, 'menu_items'), {
          ...productData,
          is_available: true
        });

        alert('Produk berhasil disimpan!');
      }

      cancelEdit();
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : 'Gagal menyimpan produk.'
      );
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (menu: MenuItem) => {
    setEditingMenu(menu);
    setName(menu.name);
    setCategory(menu.category);
    setPrice(String(menu.price));
    setDescription(menu.description || '');
    setSelectedFile(null);
    setExistingImageUrl(menu.image_url || '');
    setError('');

    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  const cancelEdit = () => {
    setEditingMenu(null);
    setName('');
    setCategory('makanan');
    setPrice('');
    setDescription('');
    setSelectedFile(null);
    setExistingImageUrl('');
    setError('');
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

        <section className="mt-4 rounded-2xl bg-green-100 p-4">
          <h2 className="font-bold text-green-900">
            Pengaturan Meja Restoran
          </h2>

          <p className="mt-1 text-sm text-green-800">
            Siapkan nomor meja 01 sampai 50 secara otomatis.
          </p>

          <button
            type="button"
            onClick={seedRestaurantTables}
            disabled={seedingTables}
            className="mt-3 w-full rounded-xl bg-green-800 py-3 font-bold text-white disabled:opacity-50"
          >
            {seedingTables
              ? 'Menyiapkan Meja...'
              : 'Siapkan 50 Meja'}
          </button>

          {seedMessage && (
            <p className="mt-3 text-sm font-semibold text-green-900">
              {seedMessage}
            </p>
          )}
        </section>

        {/* Pengelolaan QR Meja */}
        <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-green-900">
            Pengelolaan QR Meja
          </h2>

          <p className="mt-2 text-sm text-gray-600">
            Buat atau pulihkan 50 QR unik untuk meja 01 sampai 50.
            QR yang sudah tersedia tidak akan diganti.
          </p>

          <button
            type="button"
            onClick={generateTableQrs}
            disabled={qrLoading}
            className="mt-4 w-full rounded-xl bg-green-800 py-3 font-bold text-white disabled:opacity-50"
          >
            {qrLoading
              ? 'Memproses 50 QR...'
              : 'Buat / Pulihkan 50 QR'}
          </button>

          {qrMessage && (
            <p className="mt-3 rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-900">
              {qrMessage}
            </p>
          )}

          {qrItems.length === 50 && (
            <>
              <div className="mt-4 rounded-xl bg-green-50 p-3 text-sm text-green-900">
                <p className="font-bold">
                  50 QR berhasil disiapkan.
                </p>
                <p>
                  Token QR hanya tersimpan sementara selama halaman
                  Admin terbuka.
                </p>
              </div>

              <button
                type="button"
                onClick={printTableQrs}
                className="mt-4 w-full rounded-xl bg-blue-700 py-3 font-bold text-white"
              >
                Cetak 50 QR Meja
              </button>

              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {qrItems.map((item) => (
                  <div
                    key={item.tableNumber}
                    className="rounded-xl border p-3 text-center"
                  >
                    <p className="font-extrabold text-green-900">
                      {item.tableName}
                    </p>

                    <img
                      src={item.imageUrl}
                      alt={`QR ${item.tableName}`}
                      className="mx-auto mt-2 w-full"
                    />

                    <p className="mt-2 text-xs text-gray-500">
                      Scan untuk memesan
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* Form tambah dan edit produk */}
        <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold">
            {editingMenu ? 'Edit Produk' : 'Tambah Menu'}
          </h2>

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

          <div className="mb-3 rounded-xl border border-dashed p-4">
            <label className="mb-2 block font-bold">
              Foto Produk
            </label>

            <input
              type="file"
              accept="image/*"
              onChange={handlePhotoChange}
              className="w-full text-sm"
            />

            {(previewUrl || existingImageUrl) && (
              <div className="mt-3">
                <p className="mb-2 text-sm text-gray-500">
                  Pratinjau foto:
                </p>

                <img
                  src={previewUrl || existingImageUrl}
                  alt="Pratinjau produk"
                  className="h-40 w-full rounded-xl object-cover"
                />

                <button
                  type="button"
                  onClick={() => {
                    setSelectedFile(null);
                    setExistingImageUrl('');
                  }}
                  className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700"
                >
                  Hapus Foto
                </button>
              </div>
            )}
          </div>

          {error && (
            <p className="mb-3 rounded-lg bg-red-100 p-3 text-sm text-red-800">
              {error}
            </p>
          )}

          <button
            onClick={addMenu}
            disabled={saving}
            className="w-full rounded-xl bg-green-800 py-3 font-bold text-white disabled:opacity-50"
          >
            {saving
              ? 'Menyimpan...'
              : editingMenu
                ? 'Simpan Perubahan'
                : 'Simpan Produk'}
          </button>

          {editingMenu && (
            <button
              type="button"
              onClick={cancelEdit}
              className="mt-2 w-full rounded-xl bg-gray-200 py-3 font-bold text-gray-700"
            >
              Batal Edit
            </button>
          )}
        </section>

        {/* Daftar produk */}
        <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold">
            Daftar Produk ({menus.length})
          </h2>

          {menus.map((menu) => (
            <article
              key={menu.id}
              className="flex items-center justify-between gap-3 border-b py-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                {menu.image_url && (
                  <img
                    src={menu.image_url}
                    alt={menu.name}
                    className="h-16 w-16 rounded-lg object-cover"
                  />
                )}

                <div className="min-w-0">
                  <p className="font-bold">{menu.name}</p>

                  <p className="text-sm text-gray-500">
                    {menu.category} · {rupiah(Number(menu.price) || 0)}
                  </p>

                  <p className="text-xs text-gray-500">
                    {menu.is_available
                      ? 'Tersedia'
                      : 'Tidak tersedia'}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 flex-col gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(menu)}
                  className="rounded-lg bg-blue-100 px-3 py-2 text-xs font-semibold text-blue-800"
                >
                  Edit
                </button>

                <button
                  type="button"
                  onClick={() => toggleAvailability(menu)}
                  className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold"
                >
                  Ubah Status
                </button>

                <button
                  type="button"
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
