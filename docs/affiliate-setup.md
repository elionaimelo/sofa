# Afiliados do Sofa

O Sofa encaminha a compra para a loja parceira. Ele não recebe o pagamento, não vende chaves e não calcula comissão por conta própria.

## Cadastro do publicador

1. Cadastre o Sofa como canal/app e solicite aprovação em uma loja ou rede. Programas oficiais: [GOG](https://affiliate.gog.com/) e [Fanatical](https://www.fanatical.com/en/affiliates).
2. Depois da aprovação, obtenha seu ID público e os links de rastreamento aprovados para cada produto. Informe que o canal é um aplicativo distribuído para Windows.
3. Copie `src-tauri/publisher.example.json` para `src-tauri/publisher.local.json`. Esse arquivo fica fora do Git e só contém IDs públicos e links, nunca chaves de API, senhas ou credenciais de pagamento.
4. Preencha `publisher_id`, `program`, os domínios exatos aprovados em `allowed_tracking_hosts` e os produtos em `offers`. Faça um novo build para distribuir sua configuração. O usuário final não pode trocar o ID pelo menu do app.

Para releases no GitHub Actions, crie a variável de repositório `SOFA_PUBLISHER_CONFIG` com o JSON público completo. O workflow passa essa variável ao build. Sem ela, o CI usa o exemplo desativado; seu arquivo local ignorado pelo Git não é enviado automaticamente. JSON inválido ou campos desconhecidos interrompem o build.

O exemplo distribuído está desativado porque ainda não há conta de afiliado aprovada. Nenhum ID ou receita foi inventado.

## Formato de cada link aprovado

- `id`: identificador único no catálogo do Sofa.
- `steam_app_id`: identificador do jogo na Steam para associar o produto. Não é o ID do afiliado.
- `shop`: nome da loja parceira.
- `url`: link HTTPS completo fornecido/aprovado pelo programa, com seus parâmetros de atribuição.
- `quote`: `null` se não houver preço autorizado e atualizado. Quando houver, use `amount` como string decimal, `currency` com três letras maiúsculas e `expires_at` como timestamp Unix em segundos. Preços expirados não aparecem.

Esta etapa aceita links por produto. A importação automática de feeds da rede deve ser implementada depois da escolha e aprovação do programa; não existe um parâmetro de afiliado universal para todas as lojas.

## Comparação e atribuição

Os dados da CheapShark continuam com seus redirecionamentos originais. Seus links próprios aparecem em uma seção de parceiros, com aviso de afiliados e sem reutilizar preços de outro vendedor. Os links da CheapShark **não** geram comissão para o publicador do Sofa.

A [documentação da CheapShark](https://apidocs.cheapshark.com/) solicita usar seus redirecionamentos para os negócios da API. A [API do IsThereAnyDeal](https://docs.isthereanydeal.com/) também não permite alterar os dados e as tags de afiliado fornecidos; portanto, migrar para ela não resolve a atribuição ao seu ID.

Após ativar um programa, confirme a atribuição no painel da rede. Clique não equivale a venda; pedidos, aprovação da comissão, cancelamentos e pagamentos são tratados pelo programa parceiro.
