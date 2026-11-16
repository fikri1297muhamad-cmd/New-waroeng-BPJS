
import { useState } from 'react';

type Props = {
  tableNumber: number | null;
  tableQrVerified?: boolean;
  onSubmit: (name: string, table: number) => void;
};

export default function CustomerForm({
  tableNumber,
  tableQrVerified = false,
  onSubmit
}: Props) {
  const [name, setName] = useState('');

  const validName = /^[A-Za-z ]+$/.test(name.trim());

  const validTable = Boolean(
    tableNumber &&
    Number.isInteger(tableNumber) &&
    tableNumber >= 1 &&
    tableNumber <= 50 &&
    tableQrVerified
  );

  const canSubmit =
    validTable &&
    name.trim().length > 0 &&
    validName;

  const handleSubmit = () => {
    if (!validTable || !tableNumber) {
      alert('Silakan pindai QR meja yang valid terlebih dahulu.');
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
    <section className="px-1 py-1">
      <h2 className="mb-3 text-base font-extrabold text-gray-900">
        Data Pemesan
      </h2>

      <label className="mb-1.5 block text-sm font-semibold">
        Nomor Meja
      </label>

      <div className="mb-3 rounded-lg border border-gray-200 bg-white/70 px-3 py-2">
        {validTable ? (
          <span className="font-bold text-green-800">
            Meja {String(tableNumber).padStart(2, '0')}
            {' '}– Terisi
          </span>
        ) : (
          <span className="text-sm text-red-600">
            QR meja belum terverifikasi. Silakan pindai QR meja terlebih dahulu.
          </span>
        )}
      </div>

      <label className="mb-1.5 block text-sm font-semibold">
        Nama Pemesan *
      </label>

      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Masukkan nama pemesan"
        maxLength={80}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-green-700 focus:ring-2 focus:ring-green-100"
      />

      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="mt-3 w-full rounded-lg bg-green-800 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-gray-400"
      >
        Lanjutkan Pesanan
      </button>
    </section>
  );
}
