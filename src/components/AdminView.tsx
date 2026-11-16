
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
import type { MenuItem, PromoBanner } from '../types';
import QRCode from 'qrcode';

const rupiah = (value: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(Number(value) || 0);

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

type OrderStatus =
  | 'menunggu'
  | 'diproses'
  | 'siap'
  | 'selesai'
  | 'dibatalkan';

type AdminOrderItem = {
  id: string;
  order_id: string;
  menu_id: string;
  item_name: string;
  item_price: number;
  quantity: number;
  subtotal: number;
};

type AdminOrder = {
  id: string;
  order_code: string;
  customer_name: string;
  table_number: number;
  status: OrderStatus;
  payment_status: 'belum_lunas' | 'lunas';
  payment_method?: string;
  total_amount: number;
  created_at: Date;
  items: AdminOrderItem[];
};

type StaffProfile = {
  id: string;
  full_name: string;
  role: string;
  created_at?: Date | null;
};

const sectionClass =
  'min-w-0 scroll-mt-5 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm sm:p-5';

const inputClass =
  'mb-3 block min-w-0 w-full max-w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100';

const buttonClass =
  'w-full min-w-0 rounded-xl px-4 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50';

const orderStatusOptions: OrderStatus[] = [
  'menunggu',
  'diproses',
  'siap',
  'selesai',
  'dibatalkan'
];

function toDate(value: any): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value?.toDate === 'function') {
    const result = value.toDate();
    return result instanceof Date && !Number.isNaN(result.getTime())
      ? result
      : null;
  }

  const result = new Date(value);

  return Number.isNaN(result.getTime()) ? null : result;
}

function formatDate(value: Date | null | undefined) {
  if (!value) return '-';

  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(value);
}

function localDateString(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    menunggu: 'Menunggu',
    diproses: 'Diproses',
    siap: 'Siap',
    selesai: 'Selesai',
    dibatalkan: 'Dibatalkan'
  };

  return labels[status] || status || 'Tidak diketahui';
}

function statusClass(status: string) {
  const classes: Record<string, string> = {
    menunggu: 'bg-amber-100 text-amber-800',
    diproses: 'bg-blue-100 text-blue-800',
    siap: 'bg-indigo-100 text-indigo-800',
    selesai: 'bg-green-100 text-green-800',
    dibatalkan: 'bg-red-100 text-red-800'
  };

  return classes[status] || 'bg-slate-100 text-slate-700';
}

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

  const [qrItems, setQrItems] = useState<TableQrItem[]>([]);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrMessage, setQrMessage] = useState('');

  const [banners, setBanners] = useState<PromoBanner[]>([]);
  const [bannerTitle, setBannerTitle] = useState('');
  const [bannerDescription, setBannerDescription] = useState('');
  const [bannerActive, setBannerActive] = useState(true);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreviewUrl, setBannerPreviewUrl] = useState('');
  const [bannerExistingImageUrl, setBannerExistingImageUrl] = useState('');
  const [editingBanner, setEditingBanner] = useState<PromoBanner | null>(null);
  const [bannerError, setBannerError] = useState('');
  const [bannerSaving, setBannerSaving] = useState(false);

  // Data pesanan dan rincian produk.
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [orderItems, setOrderItems] = useState<AdminOrderItem[]>([]);
  const [orderError, setOrderError] = useState('');
  const [orderMessage, setOrderMessage] = useState('');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderFilter, setOrderFilter] = useState('semua');
  const [paymentMethods, setPaymentMethods] = useState<Record<string, string>>({});
  const [processingOrderId, setProcessingOrderId] = useState('');

  // Data akun staf.
  const [staffProfiles, setStaffProfiles] = useState<StaffProfile[]>([]);
  const [staffError, setStaffError] = useState('');

  // Filter laporan.
  const today = localDateString(new Date());
  const [reportStart, setReportStart] = useState(today);
  const [reportEnd, setReportEnd] = useState(today);

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
    return onSnapshot(
      collection(db, 'banners'),
      (snapshot) => {
        setBanners(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data()
          })) as PromoBanner[]
        );
      },
      (err) => {
        console.error(err);
        setBannerError(
          'Gagal membaca data banner. Periksa aturan akses Firestore.'
        );
      }
    );
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'orders'),
      (snapshot) => {
        const result = snapshot.docs.map((item) => {
          const raw = item.data();

          return {
            id: item.id,
            order_code: String(raw.order_code ?? ''),
            customer_name: String(raw.customer_name ?? ''),
            table_number: Number(raw.table_number ?? 0),
            status: String(raw.status ?? 'menunggu') as OrderStatus,
            payment_status:
              raw.payment_status === 'lunas' ? 'lunas' : 'belum_lunas',
            payment_method: String(raw.payment_method ?? ''),
            total_amount: Number(raw.total_amount ?? 0),
            created_at: toDate(raw.created_at) || new Date(0),
            items: []
          } satisfies AdminOrder;
        });

        result.sort(
          (a, b) => b.created_at.getTime() - a.created_at.getTime()
        );

        setOrders(result);
        setOrderError('');
      },
      (err) => {
        console.error(err);
        setOrderError('Gagal membaca pesanan. Periksa akses data orders.');
      }
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'order_items'),
      (snapshot) => {
        setOrderItems(
          snapshot.docs.map((item) => {
            const raw = item.data();

            return {
              id: item.id,
              order_id: String(raw.order_id ?? ''),
              menu_id: String(raw.menu_id ?? ''),
              item_name: String(raw.item_name ?? ''),
              item_price: Number(raw.item_price ?? 0),
              quantity: Number(raw.quantity ?? 0),
              subtotal: Number(raw.subtotal ?? 0)
            };
          })
        );
      },
      (err) => {
        console.error(err);
        setOrderError(
          'Gagal membaca rincian pesanan. Periksa akses koleksi order_items.'
        );
      }
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'staff_profiles'),
      (snapshot) => {
        setStaffProfiles(
          snapshot.docs.map((item) => {
            const raw = item.data();

            return {
              id: item.id,
              full_name: String(raw.full_name ?? ''),
              role: String(raw.role ?? ''),
              created_at: toDate(raw.created_at)
            };
          })
        );

        setStaffError('');
      },
      (err) => {
        console.error(err);
        setStaffError(
          'Daftar akun staf tidak dapat dibaca. Periksa izin akses data staf.'
        );
      }
    );

    return unsubscribe;
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

  useEffect(() => {
    if (!bannerFile) {
      setBannerPreviewUrl('');
      return;
    }

    const url = URL.createObjectURL(bannerFile);
    setBannerPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [bannerFile]);

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

  const handleBannerPhotoChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setBannerError('File banner harus berupa foto.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setBannerError('Ukuran foto banner maksimal 5 MB.');
      return;
    }

    setBannerError('');
    setBannerFile(file);
  };

  const uploadImageToCloudinary = async (file: File): Promise<string> => {
    const formData = new FormData();

    formData.append('file', file);
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
      console.error('Detail error Cloudinary:', result);

      throw new Error(
        `Cloudinary ${response.status}: ${
          result.error?.message || responseText
        }`
      );
    }

    return result.secure_url;
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
        imageUrl = await uploadImageToCloudinary(selectedFile);
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

  const saveBanner = async () => {
    if (!bannerTitle.trim()) {
      setBannerError('Judul banner wajib diisi.');
      return;
    }

    if (!bannerFile && !bannerExistingImageUrl) {
      setBannerError('Foto banner wajib dipilih.');
      return;
    }

    setBannerSaving(true);
    setBannerError('');

    try {
      let imageUrl = bannerExistingImageUrl;

      if (bannerFile) {
        imageUrl = await uploadImageToCloudinary(bannerFile);
      }

      const bannerData = {
        title: bannerTitle.trim(),
        description: bannerDescription.trim(),
        image_url: imageUrl,
        is_active: bannerActive
      };

      if (editingBanner) {
        await updateDoc(
          doc(db, 'banners', editingBanner.id),
          bannerData
        );

        alert('Banner berhasil diperbarui.');
      } else {
        await addDoc(collection(db, 'banners'), {
          ...bannerData,
          created_at: new Date()
        });

        alert('Banner berhasil ditambahkan.');
      }

      cancelBannerEdit();
    } catch (err) {
      console.error(err);

      setBannerError(
        err instanceof Error
          ? err.message
          : 'Gagal menyimpan banner.'
      );
    } finally {
      setBannerSaving(false);
    }
  };

  const startEditBanner = (banner: PromoBanner) => {
    setEditingBanner(banner);
    setBannerTitle(banner.title || '');
    setBannerDescription(banner.description || '');
    setBannerActive(banner.is_active === true);
    setBannerFile(null);
    setBannerExistingImageUrl(banner.image_url || '');
    setBannerError('');

    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  const cancelBannerEdit = () => {
    setEditingBanner(null);
    setBannerTitle('');
    setBannerDescription('');
    setBannerActive(true);
    setBannerFile(null);
    setBannerExistingImageUrl('');
    setBannerError('');
  };

  const toggleBannerStatus = async (banner: PromoBanner) => {
    try {
      await updateDoc(doc(db, 'banners', banner.id), {
        is_active: !banner.is_active
      });
    } catch (err) {
      console.error(err);
      setBannerError('Gagal mengubah status banner.');
    }
  };

  const removeBanner = async (banner: PromoBanner) => {
    if (!window.confirm(`Hapus banner "${banner.title}"?`)) return;

    try {
      await deleteDoc(doc(db, 'banners', banner.id));

      if (editingBanner?.id === banner.id) {
        cancelBannerEdit();
      }
    } catch (err) {
      console.error(err);
      setBannerError('Gagal menghapus banner.');
    }
  };

  // Menggabungkan dokumen orders dengan rincian order_items.
  const ordersWithItems: AdminOrder[] = orders.map((order) => ({
    ...order,
    items: orderItems.filter((item) => item.order_id === order.id)
  }));

  const filteredOrders = ordersWithItems.filter((order) => {
    const search = orderSearch.trim().toLowerCase();

    const matchesSearch =
      !search ||
      order.order_code.toLowerCase().includes(search) ||
      order.customer_name.toLowerCase().includes(search) ||
      String(order.table_number).includes(search);

    const matchesFilter =
      orderFilter === 'semua' ||
      (orderFilter === 'belum_lunas' &&
        order.payment_status === 'belum_lunas') ||
      (orderFilter === 'lunas' &&
        order.payment_status === 'lunas') ||
      order.status === orderFilter;

    return matchesSearch && matchesFilter;
  });

  const updateOrderStatus = async (
    order: AdminOrder,
    nextStatus: OrderStatus
  ) => {
    setOrderMessage('');
    setProcessingOrderId(order.id);

    try {
      await updateDoc(doc(db, 'orders', order.id), {
        status: nextStatus
      });

      setOrderMessage(
        `Status pesanan ${order.order_code || order.id} berhasil diperbarui.`
      );
    } catch (err) {
      console.error(err);
      setOrderMessage(
        'Status pesanan gagal diperbarui. Periksa izin perubahan status pesanan.'
      );
    } finally {
      setProcessingOrderId('');
    }
  };

  const recordOrderPayment = async (order: AdminOrder) => {
    setOrderMessage('');
    setProcessingOrderId(order.id);

    try {
      const user = getAuth().currentUser;

      if (!user) {
        throw new Error('Sesi login tidak ditemukan. Silakan login kembali.');
      }

      const idToken = await user.getIdToken(true);
      const paymentMethod = paymentMethods[order.id] || 'tunai';

      const response = await fetch('/api/record-payment', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        cache: 'no-store',
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

      setOrderMessage(
        `Pembayaran pesanan ${order.order_code || order.id} berhasil dicatat sebagai LUNAS.`
      );
    } catch (err) {
      console.error(err);
      setOrderMessage(
        err instanceof Error
          ? err.message
          : 'Pembayaran gagal dicatat.'
      );
    } finally {
      setProcessingOrderId('');
    }
  };

  const activeBannerCount = banners.filter(
    (banner) => banner.is_active
  ).length;

  // Perhitungan laporan hanya menggunakan pesanan yang terbaca dari Firestore.
  const reportOrders = ordersWithItems.filter((order) => {
    const date = localDateString(order.created_at);

    if (reportStart && date < reportStart) return false;
    if (reportEnd && date > reportEnd) return false;

    return true;
  });

  const paidOrders = reportOrders.filter(
    (order) => order.payment_status === 'lunas'
  );

  const unpaidOrders = reportOrders.filter(
    (order) => order.payment_status === 'belum_lunas'
  );

  const paidRevenue = paidOrders.reduce(
    (total, order) => total + order.total_amount,
    0
  );

  const unpaidTotal = unpaidOrders.reduce(
    (total, order) => total + order.total_amount,
    0
  );

  const completedOrders = reportOrders.filter(
    (order) => order.status === 'selesai'
  ).length;

  const navigation = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'menu-admin', label: 'Kelola Menu', icon: '🍽️' },
    { id: 'pesanan-admin', label: 'Kelola Pesanan', icon: '🧾' },
    { id: 'meja-admin', label: 'Pengaturan Meja', icon: '🪑' },
    { id: 'qr-admin', label: 'Pengaturan QR', icon: '▦' },
    { id: 'banner-admin', label: 'Banner Promosi', icon: '🖼️' },
    { id: 'laporan-admin', label: 'Laporan', icon: '📈' },
    { id: 'akun-admin', label: 'Akun Kasir', icon: '👥' },
    { id: 'pengaturan-admin', label: 'Pengaturan', icon: '⚙️' }
  ];

  return (
    <main className="min-h-screen w-full min-w-0 overflow-x-clip bg-slate-50 p-2 sm:p-4 lg:p-5">
      <div className="mx-auto w-full min-w-0 max-w-[1600px]">

        <header className="mb-4 flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm sm:mb-5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-green-700">
              WAROENG BPJS
            </p>
            <h1 className="mt-1 break-words text-xl font-extrabold text-slate-900 sm:text-2xl">
              Dashboard Admin
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Pusat pengelolaan restoran
            </p>
          </div>

          <div className="flex min-w-0 items-center gap-3 rounded-xl bg-green-50 px-3 py-3 sm:px-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-800 text-lg font-bold text-white">
              A
            </div>
            <div className="min-w-0">
              <p className="break-words text-sm font-bold text-green-900">
                Administrator
              </p>
              <p className="text-xs text-green-700">
                Panel Admin
              </p>
            </div>
          </div>
        </header>

        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-5">

          <aside className="h-fit min-w-0 rounded-2xl bg-green-950 p-3 text-white shadow-sm sm:p-4 lg:sticky lg:top-4">
            <p className="mb-3 px-1 text-xs font-bold uppercase tracking-widest text-green-300 sm:px-3">
              Menu Utama
            </p>

            <nav className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
              {navigation.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className="flex min-w-0 items-center gap-2 rounded-xl px-2 py-3 text-xs font-semibold text-green-50 transition hover:bg-green-800 sm:gap-3 sm:px-3 sm:text-sm"
                >
                  <span className="shrink-0 text-base">{item.icon}</span>
                  <span className="min-w-0 break-words">{item.label}</span>
                </a>
              ))}
            </nav>

            <div className="mt-5 hidden rounded-xl border border-green-800 bg-green-900/50 p-3 lg:block">
              <p className="text-xs font-semibold text-green-200">
                Status panel
              </p>
              <p className="mt-1 text-sm font-bold text-white">
                Terhubung ke data
              </p>
              <p className="mt-1 text-xs leading-relaxed text-green-300">
                Data menu, banner, pesanan, dan akun staf dibaca dari Firestore.
              </p>
            </div>
          </aside>

          <div className="min-w-0 space-y-4 sm:space-y-5">

            {/* DASHBOARD */}
            <section id="dashboard" className="min-w-0 scroll-mt-5">
              <div className="mb-4">
                <h2 className="break-words text-xl font-extrabold text-slate-900">
                  Ringkasan Dashboard
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Ringkasan data yang tersedia saat ini.
                </p>
              </div>

              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 sm:gap-4">
                <article className="min-w-0 rounded-2xl border border-green-100 bg-white p-4 shadow-sm sm:p-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-500">
                      Total Menu
                    </p>
                    <span className="shrink-0 rounded-xl bg-green-100 p-3 text-xl">
                      🍽️
                    </span>
                  </div>
                  <p className="mt-4 text-3xl font-extrabold text-green-800">
                    {menus.length}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Data menu yang tersimpan
                  </p>
                </article>

                <article className="min-w-0 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-500">
                      Banner Promosi
                    </p>
                    <span className="shrink-0 rounded-xl bg-blue-100 p-3 text-xl">
                      🖼️
                    </span>
                  </div>
                  <p className="mt-4 text-3xl font-extrabold text-blue-800">
                    {banners.length}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Total banner tersimpan
                  </p>
                </article>

                <article className="min-w-0 rounded-2xl border border-amber-100 bg-white p-4 shadow-sm sm:p-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-500">
                      Banner Aktif
                    </p>
                    <span className="shrink-0 rounded-xl bg-amber-100 p-3 text-xl">
                      📢
                    </span>
                  </div>
                  <p className="mt-4 text-3xl font-extrabold text-amber-700">
                    {activeBannerCount}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Banner yang sedang diaktifkan
                  </p>
                </article>

                <article className="min-w-0 rounded-2xl border border-purple-100 bg-white p-4 shadow-sm sm:p-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-500">
                      Total Pesanan
                    </p>
                    <span className="shrink-0 rounded-xl bg-purple-100 p-3 text-xl">
                      🧾
                    </span>
                  </div>
                  <p className="mt-4 text-3xl font-extrabold text-purple-800">
                    {orders.length}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Pesanan yang tercatat
                  </p>
                </article>
              </div>

              <div className="mt-4 min-w-0 rounded-2xl border border-green-100 bg-green-50 p-4 sm:mt-5 sm:p-5">
                <h3 className="font-bold text-green-900">
                  Selamat datang di Panel Admin
                </h3>
                <p className="mt-2 break-words text-sm leading-relaxed text-green-800">
                  Gunakan navigasi untuk mengelola menu, pesanan, meja,
                  QR, banner, laporan, akun staf, dan informasi operasional.
                </p>
              </div>
            </section>

            {/* KELOLA PESANAN */}
            <section id="pesanan-admin" className={sectionClass}>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-green-900">
                    Kelola Pesanan
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Daftar pesanan dan rincian produk diperbarui langsung dari Firestore.
                  </p>
                </div>
                <span className="w-fit rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800">
                  {orders.length} pesanan
                </span>
              </div>

              {orderError && (
                <p className="mt-3 break-words rounded-xl bg-red-50 p-3 text-sm text-red-700">
                  {orderError}
                </p>
              )}

              {orderMessage && (
                <p className="mt-3 break-words rounded-xl bg-green-50 p-3 text-sm font-semibold text-green-800">
                  {orderMessage}
                </p>
              )}

              <div className="mt-4 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  value={orderSearch}
                  onChange={(event) => setOrderSearch(event.target.value)}
                  placeholder="Cari kode, nama, atau nomor meja..."
                  className="min-w-0 rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-green-600"
                />

                <select
                  value={orderFilter}
                  onChange={(event) => setOrderFilter(event.target.value)}
                  className="min-w-0 rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-green-600"
                >
                  <option value="semua">Semua pesanan</option>
                  <option value="belum_lunas">Belum lunas</option>
                  <option value="lunas">Sudah lunas</option>
                  <option value="menunggu">Status menunggu</option>
                  <option value="diproses">Status diproses</option>
                  <option value="siap">Status siap</option>
                  <option value="selesai">Status selesai</option>
                  <option value="dibatalkan">Status dibatalkan</option>
                </select>
              </div>

              {filteredOrders.length === 0 ? (
                <div className="mt-4 rounded-xl bg-slate-50 p-5 text-center">
                  <p className="font-semibold text-slate-700">
                    {orders.length === 0
                      ? 'Belum ada pesanan.'
                      : 'Tidak ada pesanan yang cocok dengan pencarian.'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Pesanan baru akan muncul otomatis ketika tersimpan.
                  </p>
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  {filteredOrders.map((order) => (
                    <article
                      key={order.id}
                      className="min-w-0 overflow-hidden rounded-xl border border-slate-200"
                    >
                      <div className="flex min-w-0 flex-col gap-3 bg-slate-50 p-3 sm:flex-row sm:items-start sm:justify-between sm:p-4">
                        <div className="min-w-0">
                          <p className="break-words font-extrabold text-slate-900">
                            {order.order_code || order.id}
                          </p>
                          <p className="mt-1 break-words text-sm text-slate-600">
                            {order.customer_name || 'Nama pelanggan tidak tersedia'}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Meja {String(order.table_number).padStart(2, '0')}
                            {' · '}
                            {formatDate(order.created_at)}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass(order.status)}`}>
                            {statusLabel(order.status)}
                          </span>
                          <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                            order.payment_status === 'lunas'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {order.payment_status === 'lunas' ? 'LUNAS' : 'BELUM LUNAS'}
                          </span>
                        </div>
                      </div>

                      <div className="min-w-0 p-3 sm:p-4">
                        <h3 className="text-sm font-bold text-slate-800">
                          Rincian Pesanan
                        </h3>

                        {order.items.length === 0 ? (
                          <p className="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                            Rincian produk belum terbaca. Periksa data order_items.
                          </p>
                        ) : (
                          <div className="mt-2 space-y-2">
                            {order.items.map((item) => (
                              <div
                                key={item.id}
                                className="flex min-w-0 items-start justify-between gap-3 border-b border-slate-100 pb-2 text-sm last:border-0"
                              >
                                <div className="min-w-0">
                                  <p className="break-words font-semibold text-slate-800">
                                    {item.item_name}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    {item.quantity} × {rupiah(item.item_price)}
                                  </p>
                                </div>
                                <p className="shrink-0 text-right font-semibold text-slate-800">
                                  {rupiah(item.subtotal)}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-green-50 p-3">
                          <span className="text-sm font-bold text-green-900">
                            Total Pesanan
                          </span>
                          <span className="text-base font-extrabold text-green-900">
                            {rupiah(order.total_amount)}
                          </span>
                        </div>

                        <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="min-w-0">
                            <label className="mb-1 block text-xs font-bold text-slate-600">
                              Status Pesanan
                            </label>
                            <select
                              value={order.status}
                              disabled={processingOrderId === order.id}
                              onChange={(event) =>
                                updateOrderStatus(
                                  order,
                                  event.target.value as OrderStatus
                                )
                              }
                              className="w-full min-w-0 rounded-lg border border-slate-200 p-3 text-sm"
                            >
                              {orderStatusOptions.map((status) => (
                                <option key={status} value={status}>
                                  {statusLabel(status)}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="min-w-0">
                            <label className="mb-1 block text-xs font-bold text-slate-600">
                              Metode Pembayaran
                            </label>
                            {order.payment_status === 'lunas' ? (
                              <div className="rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-800">
                                {order.payment_method === 'non_tunai'
                                  ? 'Non-Tunai'
                                  : order.payment_method === 'tunai'
                                    ? 'Tunai'
                                    : 'Sudah dibayar'}
                              </div>
                            ) : (
                              <select
                                value={paymentMethods[order.id] || 'tunai'}
                                onChange={(event) =>
                                  setPaymentMethods((current) => ({
                                    ...current,
                                    [order.id]: event.target.value
                                  }))
                                }
                                className="w-full min-w-0 rounded-lg border border-slate-200 p-3 text-sm"
                              >
                                <option value="tunai">Tunai</option>
                                <option value="non_tunai">Non-Tunai</option>
                              </select>
                            )}
                          </div>
                        </div>

                        {order.payment_status !== 'lunas' && (
                          <button
                            type="button"
                            disabled={
                              processingOrderId === order.id ||
                              order.status === 'dibatalkan'
                            }
                            onClick={() => recordOrderPayment(order)}
                            className={`${buttonClass} mt-3 bg-green-800 text-white hover:bg-green-900`}
                          >
                            {processingOrderId === order.id
                              ? 'Memproses...'
                              : 'Catat Pembayaran / LUNAS'}
                          </button>
                        )}

                        {order.payment_status === 'lunas' && (
                          <p className="mt-3 rounded-lg bg-green-50 p-3 text-center text-sm font-bold text-green-800">
                            Pembayaran telah tercatat lunas.
                          </p>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* PENGATURAN MEJA */}
            <section id="meja-admin" className={sectionClass}>
              <h2 className="break-words font-bold text-green-900">
                Pengaturan Meja Restoran
              </h2>

              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                Siapkan nomor meja 01 sampai 50 secara otomatis.
              </p>

              <button
                type="button"
                onClick={seedRestaurantTables}
                disabled={seedingTables}
                className={`${buttonClass} mt-3 bg-green-800 text-white hover:bg-green-900`}
              >
                {seedingTables ? 'Menyiapkan Meja...' : 'Siapkan 50 Meja'}
              </button>

              {seedMessage && (
                <p className="mt-3 break-words rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-900">
                  {seedMessage}
                </p>
              )}
            </section>

            {/* PENGATURAN QR */}
            <section id="qr-admin" className={sectionClass}>
              <h2 className="break-words text-lg font-bold text-green-900">
                Pengelolaan QR Meja
              </h2>

              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Buat atau pulihkan 50 QR unik untuk meja 01 sampai 50.
                QR yang sudah tersedia tidak akan diganti.
              </p>

              <button
                type="button"
                onClick={generateTableQrs}
                disabled={qrLoading}
                className={`${buttonClass} mt-4 bg-green-800 text-white hover:bg-green-900`}
              >
                {qrLoading ? 'Memproses 50 QR...' : 'Buat / Pulihkan 50 QR'}
              </button>

              {qrMessage && (
                <p className="mt-3 break-words rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-900">
                  {qrMessage}
                </p>
              )}

              {qrItems.length === 50 && (
                <>
                  <div className="mt-4 rounded-xl bg-green-50 p-3 text-sm leading-relaxed text-green-900">
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
                    className={`${buttonClass} mt-4 bg-blue-700 text-white hover:bg-blue-800`}
                  >
                    Cetak 50 QR Meja
                  </button>

                  <div className="mt-5 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 xl:grid-cols-5">
                    {qrItems.map((item) => (
                      <div
                        key={item.tableNumber}
                        className="min-w-0 rounded-xl border p-2 text-center sm:p-3"
                      >
                        <p className="break-words text-sm font-extrabold text-green-900">
                          {item.tableName}
                        </p>
                        <img
                          src={item.imageUrl}
                          alt={`QR ${item.tableName}`}
                          className="mx-auto mt-2 block w-full max-w-full"
                        />
                        <p className="mt-2 break-words text-xs text-slate-500">
                          Scan untuk memesan
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>

            {/* BANNER PROMOSI */}
            <section id="banner-admin" className={sectionClass}>
              <h2 className="break-words text-lg font-bold text-green-900">
                Pengelolaan Banner Promosi
              </h2>

              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                Tambahkan promosi yang akan ditampilkan pada halaman pelanggan.
                Banner dapat diaktifkan atau dinonaktifkan kapan saja.
              </p>

              <div className="mt-4 min-w-0 rounded-xl border border-slate-200 p-3 sm:p-4">
                <h3 className="mb-3 break-words font-bold text-slate-800">
                  {editingBanner ? 'Edit Banner' : 'Tambah Banner Baru'}
                </h3>

                <label className="mb-2 block text-sm font-semibold">
                  Judul Banner *
                </label>
                <input
                  value={bannerTitle}
                  onChange={(e) => setBannerTitle(e.target.value)}
                  maxLength={100}
                  placeholder="Contoh: Promo Hemat Hari Ini"
                  className={inputClass}
                />

                <label className="mb-2 block text-sm font-semibold">
                  Deskripsi Banner
                </label>
                <textarea
                  value={bannerDescription}
                  onChange={(e) => setBannerDescription(e.target.value)}
                  maxLength={300}
                  placeholder="Tuliskan informasi promosi..."
                  className={inputClass}
                  rows={3}
                />

                <div className="mb-3 min-w-0 rounded-xl border border-dashed border-slate-300 p-3 sm:p-4">
                  <label className="mb-2 block font-bold">
                    Foto Banner *
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleBannerPhotoChange}
                    className="block w-full min-w-0 max-w-full text-sm"
                  />

                  {(bannerPreviewUrl || bannerExistingImageUrl) && (
                    <div className="mt-3 min-w-0">
                      <p className="mb-2 text-sm text-slate-500">
                        Pratinjau banner:
                      </p>
                      <img
                        src={bannerPreviewUrl || bannerExistingImageUrl}
                        alt="Pratinjau banner"
                        className="max-h-56 w-full max-w-full rounded-xl object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setBannerFile(null);
                          setBannerExistingImageUrl('');
                        }}
                        className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700"
                      >
                        Hapus Foto
                      </button>
                    </div>
                  )}
                </div>

                <label className="flex min-w-0 items-start gap-3 rounded-xl bg-green-50 p-3">
                  <input
                    type="checkbox"
                    checked={bannerActive}
                    onChange={(e) => setBannerActive(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-green-800"
                  />
                  <span className="min-w-0 break-words text-sm font-semibold text-green-900">
                    Aktifkan banner setelah disimpan
                  </span>
                </label>

                {bannerError && (
                  <p className="mt-3 break-words rounded-lg bg-red-100 p-3 text-sm text-red-800">
                    {bannerError}
                  </p>
                )}

                <button
                  type="button"
                  onClick={saveBanner}
                  disabled={bannerSaving}
                  className={`${buttonClass} mt-4 bg-green-800 text-white hover:bg-green-900`}
                >
                  {bannerSaving
                    ? 'Menyimpan Banner...'
                    : editingBanner
                      ? 'Simpan Perubahan Banner'
                      : 'Simpan Banner'}
                </button>

                {editingBanner && (
                  <button
                    type="button"
                    onClick={cancelBannerEdit}
                    className={`${buttonClass} mt-2 bg-slate-200 text-slate-700`}
                  >
                    Batal Edit Banner
                  </button>
                )}
              </div>

              <div className="mt-5 min-w-0">
                <h3 className="mb-3 break-words font-bold text-slate-800">
                  Daftar Banner ({banners.length})
                </h3>

                {banners.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                    Belum ada banner promosi.
                  </p>
                ) : (
                  <div className="min-w-0 space-y-4">
                    {banners.map((banner) => (
                      <article
                        key={banner.id}
                        className="min-w-0 overflow-hidden rounded-xl border border-slate-200"
                      >
                        {banner.image_url && (
                          <img
                            src={banner.image_url}
                            alt={banner.title}
                            className="max-h-52 w-full max-w-full object-cover"
                          />
                        )}

                        <div className="min-w-0 p-3 sm:p-4">
                          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                            <h4 className="min-w-0 break-words font-bold text-slate-900">
                              {banner.title}
                            </h4>
                            <span
                              className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
                                banner.is_active
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-slate-200 text-slate-600'
                              }`}
                            >
                              {banner.is_active ? 'Aktif' : 'Nonaktif'}
                            </span>
                          </div>

                          {banner.description && (
                            <p className="mt-2 break-words text-sm text-slate-600">
                              {banner.description}
                            </p>
                          )}

                          <div className="mt-4 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
                            <button
                              type="button"
                              onClick={() => startEditBanner(banner)}
                              className="min-w-0 rounded-lg bg-blue-100 px-3 py-2 text-sm font-semibold text-blue-800"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleBannerStatus(banner)}
                              className="min-w-0 rounded-lg bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-800"
                            >
                              {banner.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeBanner(banner)}
                              className="min-w-0 rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-700"
                            >
                              Hapus
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* LAPORAN */}
            <section id="laporan-admin" className={sectionClass}>
              <h2 className="text-lg font-bold text-green-900">
                Laporan Penjualan
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Perhitungan berdasarkan tanggal pesanan dan status pembayaran yang tercatat.
              </p>

              <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <label className="mb-1 block text-xs font-bold text-slate-600">
                    Dari tanggal
                  </label>
                  <input
                    type="date"
                    value={reportStart}
                    onChange={(event) => setReportStart(event.target.value)}
                    className="w-full min-w-0 rounded-xl border border-slate-200 p-3 text-sm"
                  />
                </div>

                <div className="min-w-0">
                  <label className="mb-1 block text-xs font-bold text-slate-600">
                    Sampai tanggal
                  </label>
                  <input
                    type="date"
                    value={reportEnd}
                    min={reportStart || undefined}
                    onChange={(event) => setReportEnd(event.target.value)}
                    className="w-full min-w-0 rounded-xl border border-slate-200 p-3 text-sm"
                  />
                </div>
              </div>

              {reportStart && reportEnd && reportStart > reportEnd && (
                <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  Tanggal awal tidak boleh melewati tanggal akhir.
                </p>
              )}

              <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <article className="rounded-xl border border-green-100 bg-green-50 p-4">
                  <p className="text-sm font-semibold text-green-800">
                    Omzet Pembayaran Lunas
                  </p>
                  <p className="mt-2 break-words text-xl font-extrabold text-green-900">
                    {rupiah(paidRevenue)}
                  </p>
                </article>

                <article className="rounded-xl border border-amber-100 bg-amber-50 p-4">
                  <p className="text-sm font-semibold text-amber-800">
                    Total Belum Lunas
                  </p>
                  <p className="mt-2 break-words text-xl font-extrabold text-amber-900">
                    {rupiah(unpaidTotal)}
                  </p>
                </article>

                <article className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                  <p className="text-sm font-semibold text-blue-800">
                    Jumlah Pesanan
                  </p>
                  <p className="mt-2 text-2xl font-extrabold text-blue-900">
                    {reportStart && reportEnd && reportStart > reportEnd
                      ? 0
                      : reportOrders.length}
                  </p>
                </article>

                <article className="rounded-xl border border-purple-100 bg-purple-50 p-4">
                  <p className="text-sm font-semibold text-purple-800">
                    Pesanan Selesai
                  </p>
                  <p className="mt-2 text-2xl font-extrabold text-purple-900">
                    {reportStart && reportEnd && reportStart > reportEnd
                      ? 0
                      : completedOrders}
                  </p>
                </article>
              </div>

              <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                <div className="bg-slate-50 p-3">
                  <h3 className="font-bold text-slate-800">
                    Rincian Pembayaran
                  </h3>
                </div>
                <div className="divide-y divide-slate-100 p-3 text-sm">
                  <div className="flex justify-between gap-3 py-2">
                    <span className="text-slate-600">Pesanan lunas</span>
                    <strong>{paidOrders.length}</strong>
                  </div>
                  <div className="flex justify-between gap-3 py-2">
                    <span className="text-slate-600">Pesanan belum lunas</span>
                    <strong>{unpaidOrders.length}</strong>
                  </div>
                  <div className="flex justify-between gap-3 py-2">
                    <span className="text-slate-600">Pesanan dibatalkan</span>
                    <strong>
                      {reportOrders.filter((order) => order.status === 'dibatalkan').length}
                    </strong>
                  </div>
                </div>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                Catatan: omzet dihitung dari pesanan berstatus lunas.
                Pesanan yang belum lunas tidak dimasukkan ke omzet.
              </p>
            </section>

            {/* AKUN KASIR */}
            <section id="akun-admin" className={sectionClass}>
              <h2 className="text-lg font-bold text-green-900">
                Akun Staf dan Kasir
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                Daftar akun dibaca dari koleksi staff_profiles.
              </p>

              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-bold text-amber-900">
                  Pengelolaan akun baru belum diaktifkan.
                </p>
                <p className="mt-1 text-xs leading-relaxed text-amber-800">
                  Pembuatan dan persetujuan akun Kasir harus dilakukan melalui
                  backend tepercaya oleh Admin. Halaman ini hanya menampilkan
                  data akun yang sudah terdaftar.
                </p>
              </div>

              {staffError && (
                <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  {staffError}
                </p>
              )}

              <div className="mt-4 flex items-center justify-between gap-3">
                <h3 className="font-bold text-slate-800">
                  Daftar Akun
                </h3>
                <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800">
                  {staffProfiles.length} akun
                </span>
              </div>

              {staffProfiles.length === 0 ? (
                <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                  Belum ada data akun yang dapat ditampilkan.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {staffProfiles.map((staff) => {
                    const role = staff.role.trim().toLowerCase();
                    const isCashier = role === 'kasir';

                    return (
                      <article
                        key={staff.id}
                        className="flex min-w-0 flex-col gap-2 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="break-words font-bold text-slate-900">
                            {staff.full_name || 'Nama belum diatur'}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {staff.created_at
                              ? `Terdaftar: ${formatDate(staff.created_at)}`
                              : 'Tanggal pendaftaran tidak tersedia'}
                          </p>
                        </div>

                        <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${
                          isCashier
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-green-100 text-green-800'
                        }`}>
                          {staff.role || 'Role belum diatur'}
                        </span>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            {/* PENGATURAN */}
            <section id="pengaturan-admin" className={sectionClass}>
              <h2 className="text-lg font-bold text-green-900">
                Pengaturan Restoran
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Informasi operasional yang digunakan oleh Website WAROENG BPJS.
              </p>

              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold text-slate-500">
                    Nama usaha
                  </p>
                  <p className="mt-1 font-bold text-slate-900">
                    WAROENG BPJS
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold text-slate-500">
                    Alamat usaha
                  </p>
                  <p className="mt-1 break-words text-sm font-semibold leading-relaxed text-slate-900">
                    Jl. Kandang Sapi 001/002 No. 01 Desa Tanjungsari
                    Kecamatan Sukaluyu Kabupaten Cianjur
                  </p>
                </div>

                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="text-xs font-semibold text-slate-500">
                      Jumlah meja
                    </p>
                    <p className="mt-1 text-xl font-extrabold text-green-800">
                      50 meja
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Nomor meja 01 sampai 50
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="text-xs font-semibold text-slate-500">
                      Sistem pembayaran
                    </p>
                    <p className="mt-1 font-bold text-slate-900">
                      Tunai dan Non-Tunai
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Pembayaran dicatat oleh petugas
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                  <p className="text-sm font-bold text-blue-900">
                    Pengaturan penyimpanan belum tersedia
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-blue-800">
                    Bagian ini saat ini menampilkan informasi operasional.
                    Belum ada perubahan yang disimpan ke database karena
                    struktur koleksi pengaturan restoran belum tersedia.
                  </p>
                </div>
              </div>
            </section>

            {/* KELOLA MENU */}
            <section id="menu-admin" className={sectionClass}>
              <h2 className="mb-4 break-words text-lg font-bold text-green-900">
                {editingMenu ? 'Edit Produk' : 'Tambah Menu'}
              </h2>

              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nama produk"
                className={inputClass}
              />

              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={inputClass}
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
                className={inputClass}
              />

              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Deskripsi produk"
                className={inputClass}
                rows={3}
              />

              <div className="mb-3 min-w-0 rounded-xl border border-dashed border-slate-300 p-3 sm:p-4">
                <label className="mb-2 block font-bold">
                  Foto Produk
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  className="block w-full min-w-0 max-w-full text-sm"
                />

                {(previewUrl || existingImageUrl) && (
                  <div className="mt-3 min-w-0">
                    <p className="mb-2 text-sm text-slate-500">
                      Pratinjau foto:
                    </p>
                    <img
                      src={previewUrl || existingImageUrl}
                      alt="Pratinjau produk"
                      className="h-40 w-full max-w-full rounded-xl object-cover"
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
                <p className="mb-3 break-words rounded-lg bg-red-100 p-3 text-sm text-red-800">
                  {error}
                </p>
              )}

              <button
                type="button"
                onClick={addMenu}
                disabled={saving}
                className={`${buttonClass} bg-green-800 text-white hover:bg-green-900`}
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
                  className={`${buttonClass} mt-2 bg-slate-200 text-slate-700`}
                >
                  Batal Edit
                </button>
              )}
            </section>

            {/* DAFTAR MENU */}
            <section id="daftar-menu-admin" className={sectionClass}>
              <h2 className="mb-4 break-words text-lg font-bold text-green-900">
                Daftar Produk ({menus.length})
              </h2>

              {menus.length === 0 ? (
                <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                  Belum ada produk.
                </p>
              ) : (
                <div className="min-w-0 divide-y divide-slate-100">
                  {menus.map((menu) => (
                    <article
                      key={menu.id}
                      className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {menu.image_url && (
                          <img
                            src={menu.image_url}
                            alt={menu.name}
                            className="h-16 w-16 shrink-0 rounded-lg object-cover"
                          />
                        )}

                        <div className="min-w-0">
                          <p className="break-words font-bold text-slate-900">
                            {menu.name}
                          </p>
                          <p className="break-words text-sm text-slate-500">
                            {menu.category} · {rupiah(Number(menu.price) || 0)}
                          </p>
                          <p className="text-xs text-slate-500">
                            {menu.is_available ? 'Tersedia' : 'Tidak tersedia'}
                          </p>
                        </div>
                      </div>

                      <div className="grid min-w-0 grid-cols-1 gap-2 sm:w-auto sm:shrink-0 sm:grid-cols-3">
                        <button
                          type="button"
                          onClick={() => startEdit(menu)}
                          className="min-w-0 rounded-lg bg-blue-100 px-3 py-2 text-xs font-semibold text-blue-800"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleAvailability(menu)}
                          className="min-w-0 rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-800"
                        >
                          Ubah Status
                        </button>
                        <button
                          type="button"
                          onClick={() => removeMenu(menu)}
                          className="min-w-0 rounded-lg bg-red-100 px-3 py-2 text-xs font-semibold text-red-700"
                        >
                          Hapus
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

          </div>
        </div>
      </div>
    </main>
  );
}
