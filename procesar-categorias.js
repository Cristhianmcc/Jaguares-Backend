const fs = require('fs');

// La data correcta (Source of Truth)
const rawData = `1	MAMAS FIT	LUNES	6:30	7:40	20	31	activo	60	Económico	adulto +18		1900	2008	Femenino
2	MAMAS FIT	LUNES	7:45	9:00	20	32	activo	60	Económico	adulto +18		1900	2008	Femenino
3	Fútbol	LUNES	8:10	9:20	20	41	activo	60	Económico	2011-2012		2011	2012	Mixto
4	Fútbol	LUNES	8:10	9:20	20	37	activo	60	Económico	2014-2013		2013	2014	Mixto
5	Fútbol Femenino	LUNES	9:20	10:30	20	25	activo	60	Económico	2010-2015		2010	2015	Femenino
6	Fútbol	LUNES	10:30	11:40	20	37	activo	60	Económico	2016-2015		2015	2016	Mixto
7	Fútbol	LUNES	10:30	11:40	20	31	activo	60	Económico	2009-2010		2009	2010	Mixto
8	Fútbol	LUNES	11:40	12:50	20	32	activo	60	Económico	2018-2017		2017	2018	Mixto
9	MAMAS FIT	MIERCOLES	6:30	7:40	20	21	activo	60	Económico	adulto +18		1900	2008	Femenino
10	MAMAS FIT	MIERCOLES	7:45	9:00	20	19	activo	60	Económico	adulto +18		1900	2008	Femenino
11	Fútbol	MIERCOLES	8:10	9:20	20	6	activo	60	Económico	2011-2012		2011	2012	Mixto
12	Fútbol	MIERCOLES	8:10	9:20	20	2	activo	60	Económico	2014-2013		2013	2014	Mixto
13	Fútbol Femenino	MIERCOLES	9:20	10:30	20	8	activo	60	Económico	2010-2015		2010	2015	Femenino
14	Fútbol	MIERCOLES	10:30	11:40	20	3	activo	60	Económico	2016-2015		2015	2016	Mixto
15	Fútbol	MIERCOLES	10:30	11:40	20	4	activo	60	Económico	2009-2010		2009	2010	Mixto
16	Fútbol	MIERCOLES	11:40	12:50	20	1	activo	60	Económico	2018-2017		2017	2018	Mixto
17	Vóley	LUNES	8:30	9:40	20	3	activo	60	Económico	2009-2008		2008	2009	Mixto
18	Vóley	LUNES	8:30	9:40	20	1	activo	60	Económico	2010		2010	2010	Mixto
19	Vóley	LUNES	9:40	10:50	20	2	activo	60	Económico	2011		2011	2011	Mixto
20	Vóley	LUNES	9:40	10:50	20	1	activo	60	Económico	2012-2013		2012	2013	Mixto
21	Vóley	LUNES	10:50	12:00	20	0	activo	60	Económico	2014		2014	2014	Mixto
22	Vóley	LUNES	10:50	12:00	20	2	activo	60	Económico	2015-2016		2015	2016	Mixto
23	Vóley	MIERCOLES	8:30	9:40	20	1	activo	60	Económico	2009-2008		2008	2009	Mixto
24	Vóley	MIERCOLES	8:30	9:40	20	0	activo	60	Económico	2010		2010	2010	Mixto
25	Vóley	MIERCOLES	9:40	10:50	20	3	activo	60	Económico	2011		2011	2011	Mixto
26	Vóley	MIERCOLES	9:40	10:50	20	2	activo	60	Económico	2012-2013		2012	2013	Mixto
27	Vóley	MIERCOLES	10:50	12:00	20	1	activo	60	Económico	2014		2014	2014	Mixto
28	Vóley	MIERCOLES	10:50	12:00	20	1	activo	60	Económico	2015-2016		2015	2016	Mixto
29	MAMAS FIT	VIERNES	6:30	7:40	20	1	activo	60	Económico	adulto +18		1900	2008	Femenino
30	MAMAS FIT	VIERNES	7:45	9:00	20	3	activo	60	Económico	adulto +18		1900	2008	Femenino
31	Vóley	VIERNES	8:30	9:40	20	0	activo	60	Económico	2009-2008		2008	2009	Mixto
32	Vóley	VIERNES	8:30	9:40	20	0	activo	60	Económico	2010		2010	2010	Mixto
33	Vóley	VIERNES	9:40	10:50	20	1	activo	60	Económico	2011		2011	2011	Mixto
34	Vóley	VIERNES	9:40	10:50	20	4	activo	60	Económico	2012-2013		2012	2013	Mixto
35	Vóley	VIERNES	10:50	12:00	20	0	activo	60	Económico	2014		2014	2014	Mixto
36	Vóley	VIERNES	10:50	12:00	20	1	activo	60	Económico	2015-2016		2015	2016	Mixto
37	Fútbol	VIERNES	8:10	9:20	20	5	activo	60	Económico	2011-2012		2011	2012	Mixto
38	Fútbol	VIERNES	8:10	9:20	20	0	activo	60	Económico	2014-2013		2013	2014	Mixto
39	Fútbol Femenino	VIERNES	9:20	10:30	20	2	activo	60	Económico	2010-2015		2010	2015	Femenino
40	Fútbol	VIERNES	10:30	11:40	20	2	activo	60	Económico	2016-2015		2015	2016	Mixto
41	Fútbol	VIERNES	10:30	11:40	20	1	activo	60	Económico	2009-2010		2009	2010	Mixto
42	Fútbol	VIERNES	11:40	12:50	20	0	activo	60	Económico	2018-2017		2017	2018	Mixto
43	Básquet	MARTES	8:30	9:40	20	1	activo	60	Económico	2009-2008		2008	2009	Mixto
44	Básquet	MARTES	8:30	9:40	20	1	activo	60	Económico	2010		2010	2010	Mixto
45	Básquet	MARTES	9:40	10:50	20	0	activo	60	Económico	2011		2011	2011	Mixto
46	Básquet	MARTES	9:40	10:50	20	3	activo	60	Económico	2012-2013		2012	2013	Mixto
47	Básquet	MARTES	10:50	12:00	20	1	activo	60	Económico	2014		2014	2014	Mixto
48	Básquet	MARTES	10:50	12:00	20	0	activo	60	Económico	2015-2016		2015	2016	Mixto
49	Básquet	JUEVES	8:30	9:40	20	1	activo	60	Económico	2009-2008		2008	2009	Mixto
50	Básquet	JUEVES	8:30	9:40	20	1	activo	60	Económico	2010		2010	2010	Mixto
51	Básquet	JUEVES	9:40	10:50	20	0	activo	60	Económico	2011		2011	2011	Mixto
52	Básquet	JUEVES	9:40	10:50	20	2	activo	60	Económico	2012-2013		2012	2013	Mixto
53	Básquet	JUEVES	10:50	12:00	20	0	activo	60	Económico	2014		2014	2014	Mixto
54	Básquet	JUEVES	10:50	12:00	20	0	activo	60	Económico	2015-2016		2015	2016	Mixto
55	ASODE	SABADO	15:30	16:30	20	15	activo	200	Premium	2009-2010	PC	2009	2010	Mixto
56	ASODE	SABADO	15:30	16:30	20	13	activo	200	Premium	2011-2012	PC	2011	2012	Mixto
57	ASODE	SABADO	16:30	17:30	20	13	activo	200	Premium	2012-2013	PC	2012	2013	Mixto
58	ASODE	SABADO	16:30	17:30	20	11	activo	200	Premium	2014	PC	2014	2014	Mixto
59	ASODE	SABADO	17:30	18:30	20	17	activo	200	Premium	2015-2016	PC	2015	2016	Mixto
60	ASODE	SABADO	17:30	18:30	20	8	activo	200	Premium	2017	PC	2017	2017	Mixto
61	Fútbol	LUNES	15:30	16:55	20	0	activo	120	Estándar	2020-2021	NF	2020	2021	Mixto
62	Fútbol	LUNES	15:30	16:55	20	12	activo	120	Estándar	2019-2020	I	2019	2020	Mixto
63	Fútbol	LUNES	17:00	18:25	20	0	activo	200	Premium	2017	PC	2017	2017	Mixto
64	Fútbol	LUNES	17:00	18:25	20	2	activo	200	Premium	2016	PC	2016	2016	Mixto
65	Fútbol	LUNES	17:00	18:25	20	0	activo	120	Estándar	2014	I	2014	2014	Mixto
66	Fútbol	LUNES	17:00	18:25	20	0	activo	120	Estándar	2015	NF	2015	2015	Mixto
67	Fútbol	LUNES	18:30	19:55	20	0	activo	200	Premium	2014	PC	2014	2014	Mixto
68	Fútbol	LUNES	18:30	19:55	20	0	activo	200	Premium	2015	PC	2015	2015	Mixto
69	Fútbol	LUNES	18:30	19:55	20	0	activo	200	Premium	2013-2014-2015	PC	2013	2015	Mixto
70	Fútbol	MIERCOLES	15:30	16:55	20	0	activo	120	Estándar	2020-2021	NF	2020	2021	Mixto
71	Fútbol	MIERCOLES	15:30	16:55	20	1	activo	120	Estándar	2019	I	2019	2019	Mixto
72	Fútbol	MIERCOLES	17:00	18:25	20	0	activo	200	Premium	2017	PC	2017	2017	Mixto
73	Fútbol	MIERCOLES	17:00	18:25	20	2	activo	200	Premium	2016	PC	2016	2016	Mixto
74	Fútbol	MIERCOLES	17:00	18:25	20	1	activo	120	Estándar	2014	I	2014	2014	Mixto
75	Fútbol	MIERCOLES	17:00	18:25	20	0	activo	120	Estándar	2015	NF	2015	2015	Mixto
76	Fútbol	MIERCOLES	18:30	19:55	20	1	activo	200	Premium	2014	PC	2014	2014	Mixto
77	Fútbol	MIERCOLES	18:30	19:55	20	0	activo	200	Premium	2015	PC	2015	2015	Mixto
78	Fútbol	MIERCOLES	18:30	19:55	20	0	activo	200	Premium	2013-2014-2015	PREMIUM	2013	2015	Mixto
79	Fútbol	VIERNES	17:00	18:25	20	0	activo	200	Premium	2017	PC	2017	2017	Mixto
80	Fútbol	VIERNES	17:00	18:25	20	2	activo	200	Premium	2016	PC	2016	2016	Mixto
81	Fútbol	VIERNES	17:00	18:25	20	0	activo	120	Estándar	2014	I	2014	2014	Mixto
82	Fútbol	VIERNES	17:00	18:25	20	0	activo	120	Estándar	2015	NF	2015	2015	Mixto
83	Fútbol	VIERNES	18:30	19:55	20	0	activo	200	Premium	2014	PC	2014	2014	Mixto
84	Fútbol	VIERNES	18:30	19:55	20	0	activo	200	Premium	2015	PC	2015	2015	Mixto
85	Fútbol	VIERNES	18:30	19:55	20	2	activo	200	Premium	2013-2014-2015	PREMIUM	2013	2015	Mixto
86	Fútbol	MARTES	15:30	16:50	20	15	activo	120	Estándar	2018-2019	NF	2018	2019	Mixto
87	Fútbol	MARTES	15:30	16:50	20	0	activo	120	Estándar	2020-2021	NF	2020	2021	Mixto
88	Fútbol	MARTES	15:30	16:50	20	3	activo	120	Estándar	2008-2009-2010-2011	NF	2008	2011	Mixto
89	Fútbol	MARTES	17:00	18:20	20	0	activo	120	Estándar	2017-2016	NF	2016	2017	Mixto
90	Fútbol	MARTES	17:00	18:20	20	1	activo	120	Estándar	2017-2016	NF	2016	2017	Mixto
91	Fútbol	MARTES	17:00	18:20	20	6	activo	120	Estándar	2014-2013-2012	NF	2012	2014	Mixto
92	Fútbol	MARTES	18:30	19:50	20	0	activo	200	Premium	2009-2010-2011-2012	PC	2009	2012	Mixto
93	Fútbol	JUEVES	15:30	16:50	20	0	activo	120	Estándar	2018-2019	NF	2018	2019	Mixto
94	Fútbol	JUEVES	15:30	16:50	20	0	activo	120	Estándar	2020-2021	NF	2020	2021	Mixto
95	Fútbol	JUEVES	15:30	16:50	20	3	activo	120	Estándar	2008-2009-2010-2011	NF	2008	2011	Mixto
96	Fútbol	JUEVES	17:00	18:20	20	0	activo	120	Estándar	2017-2016	NF	2016	2017	Mixto
97	Fútbol	JUEVES	17:00	18:20	20	0	activo	120	Estándar	2017-2016	NF	2016	2017	Mixto
98	Fútbol	JUEVES	17:00	18:20	20	6	activo	120	Estándar	2014-2013-2012	NF	2012	2014	Mixto
99	Fútbol	JUEVES	18:30	19:50	20	0	activo	200	Premium	2009-2010-2011-2012	PREMIUM	2009	2012	Mixto
100	Fútbol	SABADO	8:30	9:50	20	0	activo	0		2008-2009		2008	2009	Mixto
101	Fútbol	SABADO	8:30	9:50	20	3	activo	120	Estándar	2010-2011	NF	2010	2011	Mixto
102	Fútbol	SABADO	8:30	9:50	20	5	activo	120	Estándar	2012-2013	NF	2012	2013	Mixto
103	Fútbol	SABADO	8:30	9:50	20	0	activo	120	Estándar	2014	NF	2014	2014	Mixto
104	Fútbol	SABADO	10:00	11:20	20	0	activo	120	Estándar	2017-2016	NF	2016	2017	Mixto
105	Fútbol	SABADO	10:00	11:20	20	0	activo	120	Estándar	2017-2016	NF	2016	2017	Mixto
106	Vóley	LUNES	14:30	16:00	20	0	activo	120	Estándar	2013-2014	BÁSICO	2013	2014	Mixto
107	Vóley	LUNES	14:30	16:00	20	0	activo	120	Estándar	2015-2016	BÁSICO	2015	2016	Mixto
108	Vóley	LUNES	16:00	17:30	20	0	activo	120	Estándar	2010-2009	BÁSICO	2009	2010	Mixto
109	Vóley	LUNES	16:00	17:30	20	0	activo	120	Estándar	2012-2011	BÁSICO	2011	2012	Mixto
110	Vóley	LUNES	17:30	19:00	20	0	activo	120	Estándar	2011-2010	AVANZADO	2010	2011	Mixto
111	Vóley	LUNES	17:30	19:00	20	1	activo	120	Estándar	2013-2012	AVANZADO	2012	2013	Mixto
112	Entrenamiento Funcional Mixto	LUNES	15:45	16:45	20	6	activo	100	Estándar	adulto +18		1900	2008	Mixto
113	GYM JUVENIL	LUNES	15:00	16:00	20	5	activo	100	Estándar	2005-2009	AVANZADO	2005	2009	Mixto
114	MAMAS FIT	LUNES	16:00	17:00	20	1	activo	60	Económico	adulto +18		1900	2008	Femenino
115	Vóley	MIERCOLES	14:30	16:00	20	0	activo	120	Estándar	2013-2014	BÁSICO	2013	2014	Mixto
116	Vóley	MIERCOLES	14:30	16:00	20	0	activo	120	Estándar	2015-2016	BÁSICO	2015	2016	Mixto
117	Vóley	MIERCOLES	16:00	17:30	20	0	activo	120	Estándar	2010-2009	BÁSICO	2009	2010	Mixto
118	Vóley	MIERCOLES	16:00	17:30	20	0	activo	120	Estándar	2012-2011	BÁSICO	2011	2012	Mixto
119	Vóley	MIERCOLES	17:30	19:00	20	0	activo	120	Estándar	2011-2010	AVANZADO	2010	2011	Mixto
120	Vóley	MIERCOLES	17:30	19:00	20	0	activo	120	Estándar	2013-2012	AVANZADO	2012	2013	Mixto
121	Entrenamiento Funcional Mixto	MIERCOLES	15:45	16:45	20	0	activo	100	Estándar	adulto +18		1900	2008	Mixto
122	Vóley	VIERNES	14:30	16:00	20	1	activo	120	Estándar	2013-2014	BÁSICO	2013	2014	Mixto
123	Vóley	VIERNES	14:30	16:00	20	0	activo	120	Estándar	2015-2016	BÁSICO	2015	2016	Mixto
124	Vóley	VIERNES	16:00	17:30	20	1	activo	120	Estándar	2010-2009	BÁSICO	2009	2010	Mixto
125	Vóley	VIERNES	16:00	17:30	20	0	activo	120	Estándar	2012-2011	BÁSICO	2011	2012	Mixto
126	Vóley	VIERNES	17:30	19:00	20	1	activo	120	Estándar	2011-2010	AVANZADO	2010	2011	Mixto
127	Vóley	VIERNES	17:30	19:00	20	0	activo	120	Estándar	2013-2012	AVANZADO	2012	2013	Mixto
128	Entrenamiento Funcional Mixto	VIERNES	15:45	16:45	20	2	activo	100	Estándar	adulto +18		1900	2008	Mixto
129	GYM JUVENIL	VIERNES	15:00	16:00	20	0	activo	100	Estándar	2005-2009		2005	2009	Mixto
130	MAMAS FIT	VIERNES	16:00	17:00	20	4	activo	60	Económico	adulto +18		1900	2008	Femenino
131	Básquet	MARTES	14:30	16:00	20	0	activo	120	Estándar	2017		2017	2017	Mixto
132	Básquet	MARTES	14:30	16:00	20	0	activo	120	Estándar	2015-2016		2015	2016	Mixto
133	Básquet	MARTES	16:00	17:30	20	0	activo	120	Estándar	2014		2014	2014	Mixto
134	Básquet	MARTES	16:00	17:30	20	0	activo	120	Estándar	2012-2013		2012	2013	Mixto
135	Básquet	MARTES	17:30	19:00	20	0	activo	120	Estándar	2009		2009	2009	Mixto
136	Básquet	MARTES	17:30	19:00	20	0	activo	120	Estándar	2010-2011		2010	2011	Mixto
137	Básquet	JUEVES	14:30	16:00	20	0	activo	120	Estándar	2017		2017	2017	Mixto
138	Básquet	JUEVES	14:30	16:00	20	0	activo	120	Estándar	2015-2016		2015	2016	Mixto
139	Básquet	JUEVES	16:00	17:30	20	0	activo	120	Estándar	2011		2011	2011	Mixto
140	Básquet	JUEVES	16:00	17:30	20	1	activo	120	Estándar	2012-2013		2012	2013	Mixto
141	Básquet	JUEVES	17:30	19:00	20	1	activo	120	Estándar	2009-2008		2008	2009	Mixto
142	Básquet	JUEVES	17:30	19:00	20	1	activo	120	Estándar	2010-2011		2010	2011	Mixto
143	Básquet	SABADO	8:30	10:00	20	0	activo	120	Estándar	2009-2008		2008	2009	Mixto
144	Básquet	SABADO	8:30	10:00	20	1	activo	120	Estándar	2010-2011		2010	2011	Mixto
145	Básquet	SABADO	10:00	11:30	20	3	activo	120	Estándar	2012-2013		2012	2013	Mixto
146	Básquet	SABADO	10:00	11:30	20	1	activo	120	Estándar	2014		2014	2014	Mixto
147	Básquet	SABADO	11:30	13:00	20	1	activo	120	Estándar	2015-2016		2015	2016	Mixto
148	Básquet	SABADO	11:30	13:00	20	1	activo	120	Estándar	2017		2017	2017	Mixto
149	MAMAS FIT	LUNES	17:00	18:00	20	1	activo	60	Económico	adulto +18		1900	2008	Femenino
150	GYM JUVENIL	MIERCOLES	15:00	16:00	20	2	activo	100	Estándar	2005-2009		2005	2009	Mixto
151	MAMAS FIT	MIERCOLES	16:00	17:00	20	1	activo	60	Económico	adulto +18		1900	2008	Femenino
152	MAMAS FIT	MIERCOLES	17:00	18:00	20	3	activo	60	Económico	adulto +18		1900	2008	Femenino
153	MAMAS FIT	VIERNES	17:00	18:00	20	3	activo	60	Económico	adulto +18		1900	2008	Femenino`;

function parseData() {
    const lines = rawData.split('\n');
    const categories = new Map();

    const sportsMap = {
        'Fútbol': 1,
        'Fútbol Femenino': 2,
        'Vóley': 3,
        'Básquet': 4,
        'MAMAS FIT': 5,
        'ASODE': 6,
        'Entrenamiento Funcional Mixto': 7,
        'GYM JUVENIL': 8
    };

    lines.forEach(line => {
        const cols = line.trim().split(/\t+/);
        if (cols.length < 14) return;

        const sportName = cols[1].trim();
        const categoryName = cols[10].trim();
        const yearMin = cols[12].trim() || '1900';
        const yearMax = cols[13].trim() || '2099';

        if (!sportsMap[sportName]) return;

        const key = `${sportName}|${categoryName}`;

        if (!categories.has(key)) {
            categories.set(key, {
                deporte_id: sportsMap[sportName],
                nombre: categoryName,
                descripcion: `Categoría ${categoryName}`,
                ano_min: parseInt(yearMin),
                ano_max: parseInt(yearMax),
                orden: 1,
                estado: 'activo'
            });
        }
    });

    let sql = `SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE categorias;
SET FOREIGN_KEY_CHECKS = 1;

INSERT INTO categorias (deporte_id, nombre, descripcion, ano_min, ano_max, orden, estado) VALUES
`;

    const values = [];
    let orderCounter = 0;
    const sortedCats = Array.from(categories.values()).sort((a, b) => a.deporte_id - b.deporte_id || a.ano_min - b.ano_min);

    sortedCats.forEach(cat => {
        orderCounter++;
        values.push(`(${cat.deporte_id}, '${cat.nombre}', '${cat.descripcion}', ${cat.ano_min}, ${cat.ano_max}, ${orderCounter}, '${cat.estado}')`);
    });

    if (values.length > 0) {
        sql += values.join(',\n') + ';';
    } else {
        sql += '; -- No categories found';
    }

    fs.writeFileSync('sincronizar-categorias-v2.sql', sql);
    console.log('Archivo SQL generado con ' + values.length + ' categorias.');
}

parseData();
