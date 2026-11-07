export type MenuCategory = 'makanan' | 'minuman' | 'cemilan';

export type MenuItem = {
  id: string;
  name: string;
  category: MenuCategory;
  price: number;
  description: string;
  image_url: string;
  is_available: boolean;
};

export type OrderItem = {
  menu_id: string;
  item_name: string;
  item_price: number;
  quantity: number;
  subtotal: number;
};

export type OrderStatus =
  | 'menunggu'
  | 'diproses'
  | 'siap'
  | 'selesai'
  | 'dibatalkan';

export type Order = {
  id: string;
  order_code: string;
  customer_name: string;
  table_number: number;
  items: OrderItem[];
  total_amount: number;
  status: OrderStatus;
  payment_status: 'belum_lunas' | 'lunas';
  created_at: string;
};

export type StaffRole = 'admin' | 'kasir';
