# Hambúrguer PIBG

## Supabase

Projeto: `hcehptespejazgapynus` — [abrir painel](https://supabase.com/dashboard/project/hcehptespejazgapynus).

O banco guarda a venda ativa, reservas, pedidos confirmados, retirada e etapas da cozinha. A venda inicial começa com 150 combos de R$ 25,00.

## Criar o primeiro acesso da equipe

1. No painel do Supabase, abra **Authentication > Users > Add user**.
2. Informe o e-mail de um administrador da igreja e uma senha forte.
3. Abra **SQL Editor**, troque o e-mail no comando abaixo e execute:

```sql
insert into public.team_members (user_id, role)
select id, 'admin'
from auth.users
where email = 'administrador@igreja.com';
```

Depois disso, esse e-mail entra no painel administrativo e também no painel da cozinha.

## Segurança de publicação

O site conectado ao Supabase ainda usa confirmação de Pix simulada. Não publique esta integração como venda aberta antes de instalar o webhook do Mercado Pago; do contrário, alguém poderia confirmar uma reserva sem pagar.

A chave presente em `supabase-client.js` é pública por design. Senhas, chave `service_role`, token do Mercado Pago e senha do banco não devem ser colocados no site nem enviados ao Git.
