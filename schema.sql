CREATE TABLE users (
  id           BIGSERIAL PRIMARY KEY,
  role         TEXT NOT NULL CHECK (role IN ('creator','company','admin')),
  name         TEXT NOT NULL,
  phone        TEXT UNIQUE NOT NULL,
  email        TEXT UNIQUE,
  pass_hash    TEXT NOT NULL,
  bio          TEXT, skills TEXT, city TEXT,
  verified     BOOLEAN NOT NULL DEFAULT FALSE,
  bid_credits  INT NOT NULL DEFAULT 0 CHECK (bid_credits >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE gigs (
  id BIGSERIAL PRIMARY KEY, creator_id BIGINT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, category TEXT NOT NULL,
  base_price NUMERIC(10,2) NOT NULL CHECK (base_price > 0),
  delivery_days INT NOT NULL DEFAULT 3, active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE requests (
  id BIGSERIAL PRIMARY KEY, company_id BIGINT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, category TEXT NOT NULL, budget TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE bids (
  id BIGSERIAL PRIMARY KEY, request_id BIGINT NOT NULL REFERENCES requests(id),
  creator_id BIGINT NOT NULL REFERENCES users(id),
  price NUMERIC(10,2) NOT NULL, message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id, creator_id)
);
CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  gig_id BIGINT NOT NULL REFERENCES gigs(id),
  buyer_id BIGINT NOT NULL REFERENCES users(id),
  seller_id BIGINT NOT NULL REFERENCES users(id),
  package TEXT NOT NULL DEFAULT 'basic',
  amount NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN
    ('pending_payment','held','in_progress','delivered','completed','disputed','refunded')),
  fee NUMERIC(10,2), payout NUMERIC(10,2),
  payout_status TEXT NOT NULL DEFAULT 'none' CHECK (payout_status IN ('none','pending','paid')),
  dispute_reason TEXT, dispute_details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE payments (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('bid_pack','escrow')),
  order_id BIGINT REFERENCES orders(id), amount NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
  provider_txn TEXT UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE reviews (
  id BIGSERIAL PRIMARY KEY, order_id BIGINT UNIQUE NOT NULL REFERENCES orders(id),
  reviewer_id BIGINT NOT NULL REFERENCES users(id), creator_id BIGINT NOT NULL REFERENCES users(id),
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5), comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON requests (status, created_at DESC);
CREATE INDEX ON orders (buyer_id); CREATE INDEX ON orders (seller_id); CREATE INDEX ON orders (status);
