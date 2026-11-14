# Fontes de dados

Este arquivo acompanha as fontes avaliadas para um futuro catálogo pesquisável. Uma fonte só deve ser incorporada ao aplicativo quando sua licença permitir a reutilização e o formato puder ser normalizado sem perder a origem dos dados.

| Fonte | Cobertura observada | Uso pretendido | Situação |
| --- | --- | --- | --- |
| [arthurfelipercosta/hotwheelsapi](https://github.com/arthurfelipercosta/hotwheelsapi) | 3.531 lançamentos, 272 arquivos de castings, 215 séries e 13 marcas; anos de 1968 a 2026 | Principal candidata para catálogo Hot Wheels estruturado | Aguardando licença; o repositório não oferece uma API HTTP publicada |
| [HotApi](https://github.com/twilm/HotApi) | CSV de lançamentos e protótipo Flask | Referência histórica de campos | Sem licença; endpoint ainda não implementado |
| [Hotwheels-Data](https://github.com/pvwnthem/Hotwheels-Data) | 10.361 linhas extraídas da Fandom, com esquema variável | Comparação e conferência | Sem licença; exige normalização extensa |
| [Hot Wheels Wiki](https://hotwheels.fandom.com/wiki/Hot_Wheels) | Castings, lançamentos, séries e imagens comunitárias | Conferência de catálogo e proveniência | Conteúdo comunitário; preservar atribuição e CC BY-SA |
| [MINI GT Wiki](https://minigt.fandom.com/wiki/Full_Collection) | Código, nome, direção, marca, lançamento e observações | Catálogo MINI GT | Conteúdo comunitário; preservar atribuição e CC BY-SA |
| [Kaido House Garage Wiki](https://kaido-house-garage.fandom.com/wiki/Full_Collection) | Código, nome, cor, casting, tiragem, lançamento e observações | Catálogo Kaido House | Conteúdo comunitário; preservar atribuição e CC BY-SA |
| [Matchbox Cars Wiki](https://matchbox.fandom.com/wiki/Matchbox_Cars_Wiki) | Listas por ano, números MAN, séries e rodas | Catálogo Matchbox | Conteúdo comunitário; preservar atribuição e CC BY-SA |
| [Universo Hot Wheels](https://universohotwheels.com.br/colecoes/) | Coleções e categorias comerciais em português | Taxonomia e nomenclatura brasileira | Referência complementar; não importar preços ou estoque como catálogo permanente |

## Esquema de referência

O repositório `arthurfelipercosta/hotwheelsapi` separa casting, lançamento, série e marca. Essa distinção evita duplicar informações do veículo em cada variação e é a estrutura recomendada para um banco futuro:

- **Casting:** nome, descrição, designer, ano de estreia e fabricante do veículo real.
- **Lançamento:** código da peça, ano, série, posição, cor, tampo, base, interior, rodas, país, observações e imagens.
- **Série:** nome, ano, quantidade e lançamentos associados.
- **Marca:** nome, país de origem e castings associados.

Os registros pessoais do colecionador devem continuar separados do catálogo. Eles guardam estado da embalagem, foto própria, localização no expositor e observações pessoais, referenciando um lançamento do catálogo quando houver correspondência.
