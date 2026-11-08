USE green;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS green.state;
DROP TABLE IF EXISTS green.`order`;
DROP TABLE IF EXISTS green.food;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE food (
  order_number INT NOT NULL AUTO_INCREMENT,
  sotteok INT NOT NULL DEFAULT 0,
  chillis INT NOT NULL DEFAULT 0,
  sausage INT NOT NULL DEFAULT 0,
  PRIMARY KEY (order_number),
  CONSTRAINT chk_food_qty CHECK (sotteok >= 0 AND chillis >= 0 AND sausage >= 0)
);

CREATE TABLE `order` (
  order_number INT NOT NULL,
  name VARCHAR(45) NOT NULL,
  memo VARCHAR(100) NULL,
  payment_method VARCHAR(10) NOT NULL,
  total INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (order_number),
  CONSTRAINT fk_order_food
    FOREIGN KEY (order_number) REFERENCES food (order_number)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT chk_order_payment CHECK (payment_method IN ('cash', 'transfer')),
  CONSTRAINT chk_order_total CHECK (total >= 0)
);

CREATE TABLE state (
  order_number INT NOT NULL,
  awaiting_payment TINYINT NOT NULL DEFAULT 1,
  confirmed_payment TINYINT NOT NULL DEFAULT 0,
  received TINYINT NOT NULL DEFAULT 0,
  refund TINYINT NOT NULL DEFAULT 0,
  confirmed_at DATETIME NULL,
  received_at DATETIME NULL,
  refunded_at DATETIME NULL,
  PRIMARY KEY (order_number),
  CONSTRAINT fk_state_order
    FOREIGN KEY (order_number) REFERENCES `order` (order_number)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT chk_state_flags CHECK (
    awaiting_payment IN (0, 1)
    AND confirmed_payment IN (0, 1)
    AND received IN (0, 1)
    AND refund IN (0, 1)
    AND awaiting_payment + confirmed_payment + received + refund = 1
  )
);

ALTER TABLE `order`
  MODIFY payment_method ENUM('cash', 'transfer') NOT NULL;
