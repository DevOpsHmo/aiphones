export type OrderStatus = "PENDIENTE" | "CONFIRMADO" | "PREPARANDO" | "LISTO" | "ENTREGADO";

export interface Customer {
  id: string;
  phone: string;
  name: string | null;
  address: string | null;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  active: boolean;
  created_at: string;
}

export interface OrderItem {
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
}

export interface Order {
  id: string;
  customer_id: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  order_type: "pickup" | "delivery";
  address: string | null;
  created_at: string;
  updated_at: string;
  customers?: Pick<Customer, "name" | "phone"> | null;
}

export interface Call {
  id: string;
  call_sid: string;
  from: string;
  to: string;
  duration: number;
  transcript: string | null;
  order_id: string | null;
  created_at: string;
  orders?: { id: string; total: number; status: string } | null;
}
