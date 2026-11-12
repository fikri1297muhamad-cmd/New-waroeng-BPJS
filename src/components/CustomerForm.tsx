import { useState } from 'react';

type Props = {
  tableNumber: number | null;
  onSubmit: (name: string, table: number) => void;
};

export default function CustomerForm({
  tableNumber,
  onSubmit
}: Props) {
  const [name, setName] = useState('');

  const validName = /^[A-Za-z ]+$/.test(name.trim());

  const handleSubmit = () => {
    if (!tableNumber) {
      alert('Silakan pindai QR meja terlebih dahulu.');
      return;
    }

    if (!name.trim()) {
      alert('Nama pemesan wajib diisi.');
      return;
    }

    if (!validName) {
      alert('Nama pemesan hanya boleh menggunakan huruf.');
      return;
    }

    onSubmit(name.trim(), tableNumber);
  };

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-bold">
        Data Pemesan
      </h2>

      <label className="mb-2 block text-sm font-semibold">
        Nomor Meja
      </label>

      <div className="mb-4 rounded-xl border bg-gray-50 p-3">
        {tableNumber ? (
          <span className="font-bold text-green-800">
            Meja {String(tableNumber).padStart(2, '0')}
          </span>
        ) : (
          <span className="text-sm text-red-600">
            Belum terhubung. Silakan pindai QR meja.
          </span>
        )}
      </div>

      <label className="mb-2 block text-sm font-semibold">
        Nama Pemesan *
      </label>

      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Masukkan nama pemesan"
        maxLength={80}
        className="w-full rounded-xl border p-3"
      />

      <button
        onClick={handleSubmit}
        disabled={!tableNumber}
        className="mt-4 w-full rounded-xl bg-green-800 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-gray-400"
      >
        Lanjutkan Pesanan
      </button>
    </section>
  );
}

