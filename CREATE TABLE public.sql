CREATE TABLE public.email_otps (
	id serial8 NOT NULL,
	email text NOT NULL,
	code_hash text NOT NULL,
	expires_at timestamptz NOT NULL,
	attempts int4 DEFAULT 0 NOT NULL,
	consumed_at timestamptz NULL,
	created_at timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT email_otps_pkey PRIMARY KEY (id)
)