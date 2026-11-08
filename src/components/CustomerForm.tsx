import { useState } from 'react';

type Props = {
  onSubmit: (name: string, table: number) => void;
};

export default function CustomerForm({ onSubmit }: Props) {
  const [name, setName] = useState('');
  const [table, setTable] = useState('');

  const validName = /^[A-Za-z ]+$/.test(name.trim());

  const handleSubmit = () => {
    if (!table || !name.trim()) {
      alert('Nomor meja dan nama pemesan wajib diisi.');
      return;
    }

    if (!validName) {
      alert('Nama pemesan hanya boleh menggunakan huruf.');
      return;
    }

    onSubmit(name.trim(), Number(table));
  };

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-bold">
        Data Pemesan
      </h2>

      <label className="mb-2 block text-sm font-semibold">
        Nomor Meja (01–50) *
      </label>

      <select
        value={table}
        onChange={(e) => setTable(e.target.value)}
        className="mb-4 w-full rounded-xl border p-3"
      >
        <option value="">Pilih nomor meja</option>
        {Array.from({ length: 50 }, (_, i) => (
          <option key={i + 1} value={i + 1}>
            Meja {String(i + 1).padStart(2, '0')}
          </option>
        ))}
      </select>

      <label className="mb-2 block text-sm font-semibold">
        Nama Pemesan *
      </label>

      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Masukkan nama pemesan"
        className="w-full rounded-xl border p-3"
      />

      <button
        onClick={handleSubmit}
        className="mt-4 w-full rounded-xl bg-green-800 py-3 font-bold text-white"
      >
        Lanjutkan Pesanan
      </button>
    </section>
  );
      }
