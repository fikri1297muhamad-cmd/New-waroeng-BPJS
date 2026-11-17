import type { ChangeEvent } from 'react';

type Props = {
  tableNumber: number | null;
  tableQrVerified?: boolean;
  name: string;
  onNameChange: (name: string) => void;
};

export default function CustomerForm({
  tableNumber,
  tableQrVerified = false,
  name,
  onNameChange
}: Props) {
  const validName = /^[A-Za-z ]+$/.test(name.trim());

  const validTable = Boolean(
    tableNumber &&
    Number.isInteger(tableNumber) &&
    tableNumber >= 1 &&
    tableNumber <= 50 &&
    tableQrVerified
  );

  const handleNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    onNameChange(event.target.value);
  };

  return (
    <section className="px-1 py-1">
      <h2 className="mb-2 text-sm font-extrabold text-gray-900">
        Data Pemesan
      </h2>

      <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white/70 px-3 py-2">
        <div>
          <p className="text-[10px] text-gray-500">Nomor Meja</p>
          <p className="text-sm font-bold text-gray-800">
            {validTable
              ? `Meja ${String(tableNumber).padStart(2, '0')}`
              : 'Belum tersedia'}
          </p>
        </div>

        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${
          validTable
            ? 'bg-green-100 text-green-800'
            : 'bg-amber-100 text-amber-800'
        }`}>
          {validTable ? 'Terverifikasi' : 'Belum terverifikasi'}
        </span>
      </div>

      <label className="mb-1 block text-xs font-semibold text-gray-700">
        Nama Pemesan *
      </label>

      <input
        type="text"
        value={name}
        onChange={handleNameChange}
        placeholder="Masukkan nama pemesan"
        maxLength={80}
        autoComplete="name"
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-green-700 focus:ring-2 focus:ring-green-100"
      />

      {name.trim().length > 0 && !validName && (
        <p className="mt-1 text-[10px] text-red-600">
          Nama hanya boleh menggunakan huruf dan spasi.
        </p>
      )}
    </section>
  );
}
