export const example = {
  name: "Weekly orders · Oct 12 → Oct 19",
  key: "order_id",
  before: {
    filename: "orders-oct-12.csv",
    delimiter: ",",
    csv: "order_id,customer,status,total\r\nORD-001,North Studio,pending,120.00\r\nORD-002,Field Supply,paid,85.00\r\nORD-003,Cedar Works,paid,210.00\r\nORD-004,Oak Press,paid,42.50",
  },
  after: {
    filename: "orders-oct-19.csv",
    delimiter: ",",
    csv: "order_id,customer,status,total\r\nORD-004,Oak Press,paid,42.50\r\nORD-001,North Studio,paid,120.00\r\nORD-003,Cedar Works,paid,225.00\r\nORD-005,Paper House,pending,60.00",
  },
};
