# Hambúrguer PIBG

## Supabase

Projeto: `hcehptespejazgapynus` — [abrir painel](https://supabase.com/dashboard/project/hcehptespejazgapynus).

O banco guarda a venda ativa, reservas, pedidos confirmados, retirada e etapas da cozinha. A venda inicial começa com 150 combos de R$ 25,00.

## Criar os acessos privados

No painel do Supabase, abra **Authentication > Users > Add user** e crie:

- Uma conta compartilhada, por exemplo `equipe@pibg.com`, usada por recepção e cozinha.
- Sua conta pessoal de administrador, com senha forte e não compartilhada.

Depois, abra **SQL Editor**, troque os dois e-mails e execute:

```sql
insert into public.team_members (user_id, role)
select id,
  case
    when email = 'equipe@pibg.com' then 'team'
    when email = 'administrador@igreja.com' then 'admin'
  end
from auth.users
where email in ('equipe@pibg.com', 'administrador@igreja.com')
on conflict (user_id) do update set role = excluded.role;
```

Quem entra com a conta compartilhada pode registrar venda presencial, ler o QR Code para entregar pedidos e abrir a cozinha. A conta de administrador também pode alterar a quantidade total de combos da venda ativa.

Em produção, a câmera do celular exige que o site esteja em HTTPS; Vercel já entrega isso automaticamente no domínio público.

## Segurança de publicação

O site conectado ao Supabase ainda usa confirmação de Pix simulada. Não publique esta integração como venda aberta antes de instalar o webhook do Mercado Pago; do contrário, alguém poderia confirmar uma reserva sem pagar.

A chave presente em `supabase-client.js` é pública por design. Senhas, chave `service_role`, token do Mercado Pago e senha do banco não devem ser colocados no site nem enviados ao Git.
