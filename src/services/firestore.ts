
import {
  collection,
  onSnapshot
} from 'firebase/firestore';

import { db } from '../firebase';
import type { MenuItem } from '../types';

export function listenToMenus(
  callback: (menus: MenuItem[]) => void,
  onError?: (error: Error) => void
) {
  const menuCollection = collection(db, 'menu_items');

  return onSnapshot(
    menuCollection,
    (snapshot) => {
      const menus = snapshot.docs.map((doc) => {
        const raw = doc.data();

        return {
          id: doc.id,
          name: String(raw.Nama ?? raw.name ?? ''),
          description: String(
            raw.Description ?? raw.description ?? ''
          ),
          image_url: String(
            raw.Image_url ?? raw.image_url ?? ''
          ),
          price: Number(raw.Price ?? raw.price ?? 0),
          category: String(
            raw.Category ?? raw.category ?? ''
          ).trim().toLowerCase(),
          is_available:
            raw.is_available !== false
        } as MenuItem;
      });

      callback(
        menus.filter((menu) => menu.is_available !== false)
      );
    },
    (error) => onError?.(error)
  );
}

export async function createOrder(data: {
  customer_name: string;
  table_number: number;
  items: {
    menu_id: string;
    item_name: string;
    item_price: number;
    quantity: number;
    subtotal: number;
  }[];
  total_amount: number;
}) {
  const response = await fetch('/api/create-order', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      customer_name: data.customer_name,
      table_number: data.table_number,
      items: data.items.map(item => ({
        menuId: item.menu_id,
        quantity: item.quantity
      }))
    })
  });

  const result = await response.json();

  if (!response.ok || result.success !== true) {
    throw new Error(
      result.error || 'Pesanan gagal disimpan.'
    );
  }

  return {
    id: result.order.orderId,
    order_code: result.order.orderCode
  };
}
