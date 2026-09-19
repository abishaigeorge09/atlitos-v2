# S4 production similarity measurement (2026-09-19)

Source: `query_embedding_cache` (three guest queries against production `ai-search`, voyage-3,
input_type query) joined to `affiliate_products.embedding` (8 products, voyage-3, input_type
document), cosine similarity `1 - (embedding <=> query)`.

| Query | Product | Similarity |
|---|---|---|
| shoes that grip an indoor court | Asics Gel Rocket Court Shoes | 0.565 |
| shoes that grip an indoor court | Nike Court Lite Tennis Shoes | 0.530 |
| shoes that grip an indoor court | Babolat Pure Drive Team Tennis Racket | 0.357 |
| shoes that grip an indoor court | Yonex Astrox 99 Pro Badminton Racket | 0.334 |
| shoes that grip an indoor court | Kookaburra Kids Cricket Bat Size 4 | 0.196 |
| something for a beginner learning to serve in tennis | Babolat Boost Drive Tennis Racket | 0.402 |
| something for a beginner learning to serve in tennis | Nike Court Lite Tennis Shoes | 0.346 |
| something for a beginner learning to serve in tennis | Kookaburra Kids Cricket Bat Size 4 | 0.270 |
| lightweight frame for smashing in badminton | Babolat Boost Drive Tennis Racket | 0.443 |
| lightweight frame for smashing in badminton | Yonex Astrox 99 Pro Badminton Racket | 0.366 |
| lightweight frame for smashing in badminton | SG Player Edition English Willow Cricket Bat | 0.226 |

The original floor of 0.75 was never cleared by any real query. Relevant rows sit at 0.40 to
0.57 and unrelated rows at or under 0.36 on this catalogue, so `VECTOR_SIMILARITY_FLOOR` is
0.38. Before the change the third query returned an empty broaden; after it the beginner
tennis racket is recalled by vector alone (`s4-prod-hybrid-after-calibration.txt`). The
badminton racket still misses at 0.366: the seed description carries none of the query's
words and the margin is thin. Re-measure on the real catalogue.
