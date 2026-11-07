import {
  collection,
  onSnapshot,
  query,
  orderBy
} from 'firebase/firestore';

import { db } from '../firebase';
import type { MenuItem } from '../types';

import { db } from '../firebase';
import type { MenuItem } from '../types';

export function listenToMenus(
  callback: (menus: MenuItem[]) => void,
  onError?: (error: Error) => void
) {
  const menuQuery = query(
    collection(db, 'menu_items'),
    orderBy('name')
  );

  return onSnapshot(
    menuQuery,
    (snapshot) => {
      const menus = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      })) as MenuItem[];

      callback(menus.filter((menu) => menu.is_available !== false));
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
