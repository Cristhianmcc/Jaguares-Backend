-- MySQL dump 10.13  Distrib 8.0.43, for Win64 (x86_64)
--
-- Host: localhost    Database: jaguares_db
-- ------------------------------------------------------
-- Server version	8.0.44

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Current Database: `jaguares_db`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `jaguares_db` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `jaguares_db`;

--
-- Table structure for table `administradores`
--

DROP TABLE IF EXISTS `administradores`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `administradores` (
  `admin_id` int NOT NULL AUTO_INCREMENT,
  `usuario` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre_completo` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rol` enum('super_admin','admin','profesor') COLLATE utf8mb4_unicode_ci DEFAULT 'admin',
  `estado` enum('activo','inactivo') COLLATE utf8mb4_unicode_ci DEFAULT 'activo',
  `ultimo_acceso` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `last_login` timestamp NULL DEFAULT NULL,
  `failed_login_attempts` int DEFAULT '0',
  `locked_until` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`admin_id`),
  UNIQUE KEY `usuario` (`usuario`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_usuario` (`usuario`),
  KEY `idx_email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `alumnos`
--

DROP TABLE IF EXISTS `alumnos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `alumnos` (
  `alumno_id` int NOT NULL AUTO_INCREMENT,
  `dni` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombres` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `apellido_paterno` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `apellido_materno` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fecha_nacimiento` date NOT NULL,
  `sexo` enum('Masculino','Femenino') COLLATE utf8mb4_unicode_ci NOT NULL,
  `telefono` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `direccion` text COLLATE utf8mb4_unicode_ci,
  `seguro_tipo` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `condicion_medica` text COLLATE utf8mb4_unicode_ci,
  `apoderado` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `telefono_apoderado` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dni_frontal_url` text COLLATE utf8mb4_unicode_ci,
  `dni_reverso_url` text COLLATE utf8mb4_unicode_ci,
  `foto_carnet_url` text COLLATE utf8mb4_unicode_ci,
  `comprobante_pago_url` text COLLATE utf8mb4_unicode_ci,
  `estado` enum('activo','inactivo','suspendido') COLLATE utf8mb4_unicode_ci DEFAULT 'activo',
  `estado_pago` enum('pendiente','confirmado','rechazado') COLLATE utf8mb4_unicode_ci DEFAULT 'pendiente',
  `fecha_pago` timestamp NULL DEFAULT NULL,
  `monto_pago` decimal(10,2) DEFAULT NULL,
  `numero_operacion` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notas_pago` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`alumno_id`),
  UNIQUE KEY `dni` (`dni`),
  KEY `idx_dni` (`dni`),
  KEY `idx_nombres` (`nombres`,`apellido_paterno`),
  KEY `idx_estado_pago` (`estado_pago`),
  KEY `idx_alumnos_dni` (`dni`)
) ENGINE=InnoDB AUTO_INCREMENT=760 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `asistencias`
--

DROP TABLE IF EXISTS `asistencias`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `asistencias` (
  `asistencia_id` int NOT NULL AUTO_INCREMENT,
  `alumno_id` int NOT NULL,
  `horario_id` int NOT NULL,
  `fecha` date NOT NULL,
  `presente` tinyint(1) DEFAULT '0',
  `observaciones` text COLLATE utf8mb4_unicode_ci,
  `registrado_por` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`asistencia_id`),
  UNIQUE KEY `unique_asistencia` (`alumno_id`,`horario_id`,`fecha`),
  KEY `idx_alumno_fecha` (`alumno_id`,`fecha`),
  KEY `idx_horario_fecha` (`horario_id`,`fecha`),
  CONSTRAINT `asistencias_ibfk_1` FOREIGN KEY (`alumno_id`) REFERENCES `alumnos` (`alumno_id`) ON DELETE CASCADE,
  CONSTRAINT `asistencias_ibfk_2` FOREIGN KEY (`horario_id`) REFERENCES `horarios` (`horario_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `categorias`
--

DROP TABLE IF EXISTS `categorias`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `categorias` (
  `categoria_id` int NOT NULL AUTO_INCREMENT,
  `deporte_id` int NOT NULL,
  `nombre` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Nombre de la categor??a (ej: 2011-2012, Juvenil)',
  `descripcion` text COLLATE utf8mb4_unicode_ci COMMENT 'Descripci??n adicional de la categor??a',
  `ano_min` int DEFAULT NULL COMMENT 'A??o de nacimiento m??nimo permitido',
  `ano_max` int DEFAULT NULL COMMENT 'A??o de nacimiento m??ximo permitido',
  `icono` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `orden` int DEFAULT '0' COMMENT 'Orden de visualizaci??n (menor primero)',
  `estado` enum('activo','inactivo') COLLATE utf8mb4_unicode_ci DEFAULT 'activo',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`categoria_id`),
  UNIQUE KEY `unique_deporte_categoria` (`deporte_id`,`nombre`),
  KEY `idx_deporte` (`deporte_id`),
  KEY `idx_estado` (`estado`),
  KEY `idx_rango_edad` (`ano_min`,`ano_max`),
  CONSTRAINT `categorias_ibfk_1` FOREIGN KEY (`deporte_id`) REFERENCES `deportes` (`deporte_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=64 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `deportes`
--

DROP TABLE IF EXISTS `deportes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `deportes` (
  `deporte_id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` text COLLATE utf8mb4_unicode_ci,
  `icono` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `estado` enum('activo','inactivo') COLLATE utf8mb4_unicode_ci DEFAULT 'activo',
  `matricula` decimal(10,2) DEFAULT '20.00',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`deporte_id`),
  UNIQUE KEY `nombre` (`nombre`),
  KEY `idx_nombre` (`nombre`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `horarios`
--

DROP TABLE IF EXISTS `horarios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `horarios` (
  `horario_id` int NOT NULL AUTO_INCREMENT,
  `deporte_id` int NOT NULL,
  `dia` enum('LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO','DOMINGO') COLLATE utf8mb4_unicode_ci NOT NULL,
  `hora_inicio` time NOT NULL,
  `hora_fin` time NOT NULL,
  `cupo_maximo` int NOT NULL DEFAULT '20',
  `cupos_ocupados` int NOT NULL DEFAULT '0',
  `estado` enum('activo','inactivo','suspendido') COLLATE utf8mb4_unicode_ci DEFAULT 'activo',
  `categoria` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nivel` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ano_min` int DEFAULT NULL,
  `ano_max` int DEFAULT NULL,
  `año_min` int DEFAULT NULL,
  `año_max` int DEFAULT NULL,
  `genero` enum('Masculino','Femenino','Mixto') COLLATE utf8mb4_unicode_ci DEFAULT 'Mixto',
  `precio` decimal(10,2) NOT NULL,
  `plan` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`horario_id`),
  KEY `idx_deporte_dia` (`deporte_id`,`dia`),
  KEY `idx_horario` (`hora_inicio`,`hora_fin`),
  KEY `idx_estado` (`estado`),
  KEY `idx_dia` (`dia`),
  KEY `idx_categoria` (`categoria`),
  KEY `idx_horarios_cupos` (`estado`,`cupo_maximo`,`cupos_ocupados`),
  CONSTRAINT `horarios_ibfk_1` FOREIGN KEY (`deporte_id`) REFERENCES `deportes` (`deporte_id`) ON DELETE CASCADE,
  CONSTRAINT `chk_precio_positivo` CHECK ((`precio` >= 0))
) ENGINE=InnoDB AUTO_INCREMENT=154 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inscripcion_horarios`
--

DROP TABLE IF EXISTS `inscripcion_horarios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inscripcion_horarios` (
  `id` int NOT NULL AUTO_INCREMENT,
  `inscripcion_id` int NOT NULL,
  `horario_id` int NOT NULL,
  `fecha_asignacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `estado` enum('activo','inactivo') COLLATE utf8mb4_unicode_ci DEFAULT 'activo',
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_inscripcion_horario` (`inscripcion_id`,`horario_id`),
  KEY `idx_inscripcion` (`inscripcion_id`),
  KEY `idx_horario` (`horario_id`),
  CONSTRAINT `inscripcion_horarios_ibfk_1` FOREIGN KEY (`inscripcion_id`) REFERENCES `inscripciones` (`inscripcion_id`) ON DELETE CASCADE,
  CONSTRAINT `inscripcion_horarios_ibfk_2` FOREIGN KEY (`horario_id`) REFERENCES `horarios` (`horario_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=92 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = latin1 */ ;
/*!50003 SET character_set_results = latin1 */ ;
/*!50003 SET collation_connection  = latin1_swedish_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER `after_inscripcion_horario_insert` AFTER INSERT ON `inscripcion_horarios` FOR EACH ROW BEGIN
    
    IF (SELECT estado FROM inscripciones WHERE inscripcion_id = NEW.inscripcion_id) != 'cancelada' THEN
        UPDATE horarios 
        SET cupos_ocupados = cupos_ocupados + 1
        WHERE horario_id = NEW.horario_id;
    END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = latin1 */ ;
/*!50003 SET character_set_results = latin1 */ ;
/*!50003 SET collation_connection  = latin1_swedish_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER `after_inscripcion_horario_delete` AFTER DELETE ON `inscripcion_horarios` FOR EACH ROW BEGIN
    
    IF (SELECT estado FROM inscripciones WHERE inscripcion_id = OLD.inscripcion_id) != 'cancelada' THEN
        UPDATE horarios 
        SET cupos_ocupados = GREATEST(cupos_ocupados - 1, 0)
        WHERE horario_id = OLD.horario_id;
    END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `inscripciones`
--

DROP TABLE IF EXISTS `inscripciones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inscripciones` (
  `inscripcion_id` int NOT NULL AUTO_INCREMENT,
  `codigo_operacion` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `alumno_id` int NOT NULL,
  `deporte_id` int NOT NULL,
  `fecha_inscripcion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `estado` enum('pendiente','activa','cancelada','suspendida') COLLATE utf8mb4_unicode_ci DEFAULT 'pendiente',
  `plan` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `precio_mensual` decimal(10,2) NOT NULL,
  `matricula_pagada` tinyint(1) DEFAULT '0',
  `fecha_inicio` date DEFAULT NULL,
  `fecha_fin` date DEFAULT NULL,
  `observaciones` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`inscripcion_id`),
  KEY `deporte_id` (`deporte_id`),
  KEY `idx_alumno` (`alumno_id`),
  KEY `idx_estado` (`estado`),
  KEY `idx_fecha_inscripcion` (`fecha_inscripcion`),
  KEY `idx_inscripciones_estado` (`estado`),
  KEY `idx_inscripciones_fecha` (`fecha_inscripcion`),
  CONSTRAINT `inscripciones_ibfk_1` FOREIGN KEY (`alumno_id`) REFERENCES `alumnos` (`alumno_id`) ON DELETE CASCADE,
  CONSTRAINT `inscripciones_ibfk_2` FOREIGN KEY (`deporte_id`) REFERENCES `deportes` (`deporte_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1030 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = latin1 */ ;
/*!50003 SET character_set_results = latin1 */ ;
/*!50003 SET collation_connection  = latin1_swedish_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER `after_inscripcion_update` AFTER UPDATE ON `inscripciones` FOR EACH ROW BEGIN
    
    IF OLD.estado != 'cancelada' AND NEW.estado = 'cancelada' THEN
        UPDATE horarios h
        JOIN inscripcion_horarios ih ON h.horario_id = ih.horario_id
        SET h.cupos_ocupados = GREATEST(h.cupos_ocupados - 1, 0)
        WHERE ih.inscripcion_id = NEW.inscripcion_id;
    END IF;
    
    
    IF OLD.estado = 'cancelada' AND NEW.estado != 'cancelada' THEN
        UPDATE horarios h
        JOIN inscripcion_horarios ih ON h.horario_id = ih.horario_id
        SET h.cupos_ocupados = h.cupos_ocupados + 1
        WHERE ih.inscripcion_id = NEW.inscripcion_id;
    END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `inscripciones_horarios`
--

DROP TABLE IF EXISTS `inscripciones_horarios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inscripciones_horarios` (
  `inscripcion_horario_id` int NOT NULL AUTO_INCREMENT,
  `inscripcion_id` int NOT NULL,
  `horario_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`inscripcion_horario_id`),
  UNIQUE KEY `unique_inscripcion_horario` (`inscripcion_id`,`horario_id`),
  KEY `horario_id` (`horario_id`),
  CONSTRAINT `inscripciones_horarios_ibfk_1` FOREIGN KEY (`inscripcion_id`) REFERENCES `inscripciones` (`inscripcion_id`) ON DELETE CASCADE,
  CONSTRAINT `inscripciones_horarios_ibfk_2` FOREIGN KEY (`horario_id`) REFERENCES `horarios` (`horario_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1164 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `logs_actividad`
--

DROP TABLE IF EXISTS `logs_actividad`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `logs_actividad` (
  `log_id` int NOT NULL AUTO_INCREMENT,
  `admin_id` int DEFAULT NULL,
  `accion` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tabla_afectada` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `registro_id` int DEFAULT NULL,
  `descripcion` text COLLATE utf8mb4_unicode_ci,
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`log_id`),
  KEY `idx_admin` (`admin_id`),
  KEY `idx_fecha` (`created_at`),
  CONSTRAINT `logs_actividad_ibfk_1` FOREIGN KEY (`admin_id`) REFERENCES `administradores` (`admin_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pagos`
--

DROP TABLE IF EXISTS `pagos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pagos` (
  `pago_id` int NOT NULL AUTO_INCREMENT,
  `inscripcion_id` int NOT NULL,
  `tipo_pago` enum('matricula','mensualidad','clase_extra') COLLATE utf8mb4_unicode_ci NOT NULL,
  `monto` decimal(10,2) NOT NULL,
  `fecha_pago` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `metodo_pago` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `banco` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `numero_operacion` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `comprobante_url` text COLLATE utf8mb4_unicode_ci,
  `estado` enum('pendiente','verificado','rechazado') COLLATE utf8mb4_unicode_ci DEFAULT 'pendiente',
  `verificado_por` int DEFAULT NULL,
  `fecha_verificacion` timestamp NULL DEFAULT NULL,
  `observaciones` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`pago_id`),
  KEY `idx_inscripcion` (`inscripcion_id`),
  KEY `idx_estado` (`estado`),
  KEY `idx_fecha_pago` (`fecha_pago`),
  CONSTRAINT `pagos_ibfk_1` FOREIGN KEY (`inscripcion_id`) REFERENCES `inscripciones` (`inscripcion_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pagos_mensuales`
--

DROP TABLE IF EXISTS `pagos_mensuales`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pagos_mensuales` (
  `pago_id` int NOT NULL AUTO_INCREMENT,
  `alumno_id` int NOT NULL,
  `mes` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `año` int NOT NULL,
  `monto` decimal(10,2) NOT NULL,
  `comprobante_url` text COLLATE utf8mb4_unicode_ci,
  `fecha_pago` datetime DEFAULT NULL,
  `estado` enum('pendiente','confirmado','rechazado') COLLATE utf8mb4_unicode_ci DEFAULT 'pendiente',
  `metodo_pago` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `observaciones` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pago_id`),
  UNIQUE KEY `unique_alumno_mes` (`alumno_id`,`mes`,`año`),
  CONSTRAINT `pagos_mensuales_ibfk_1` FOREIGN KEY (`alumno_id`) REFERENCES `alumnos` (`alumno_id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `usuarios`
--

DROP TABLE IF EXISTS `usuarios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuarios` (
  `usuario_id` int NOT NULL AUTO_INCREMENT,
  `dni` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombres` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `apellidos` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fecha_nacimiento` date NOT NULL,
  `edad` int DEFAULT NULL,
  `sexo` enum('Masculino','Femenino','Mixto') COLLATE utf8mb4_unicode_ci NOT NULL,
  `telefono` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `apoderado` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `direccion` text COLLATE utf8mb4_unicode_ci,
  `seguro_tipo` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `condicion_medica` text COLLATE utf8mb4_unicode_ci,
  `telefono_apoderado` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `url_dni_frontal` text COLLATE utf8mb4_unicode_ci,
  `url_dni_reverso` text COLLATE utf8mb4_unicode_ci,
  `url_foto_carnet` text COLLATE utf8mb4_unicode_ci,
  `url_comprobante` text COLLATE utf8mb4_unicode_ci,
  `estado_usuario` enum('pendiente','activo','inactivo') COLLATE utf8mb4_unicode_ci DEFAULT 'pendiente',
  `estado_pago` enum('pendiente','confirmado','rechazado') COLLATE utf8mb4_unicode_ci DEFAULT 'pendiente',
  `fecha_pago` datetime DEFAULT NULL,
  `monto_pago` decimal(10,2) DEFAULT NULL,
  `numero_operacion` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notas_pago` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`usuario_id`),
  UNIQUE KEY `dni` (`dni`),
  KEY `idx_dni` (`dni`),
  KEY `idx_estado_pago` (`estado_pago`),
  KEY `idx_estado_usuario` (`estado_usuario`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Temporary view structure for view `vista_horarios_completos`
--

DROP TABLE IF EXISTS `vista_horarios_completos`;
/*!50001 DROP VIEW IF EXISTS `vista_horarios_completos`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `vista_horarios_completos` AS SELECT 
 1 AS `horario_id`,
 1 AS `deporte`,
 1 AS `dia`,
 1 AS `hora_inicio`,
 1 AS `hora_fin`,
 1 AS `cupo_maximo`,
 1 AS `cupos_ocupados`,
 1 AS `cupos_disponibles`,
 1 AS `estado`,
 1 AS `categoria`,
 1 AS `nivel`,
 1 AS `genero`,
 1 AS `precio`,
 1 AS `plan`,
 1 AS `año_min`,
 1 AS `año_max`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary view structure for view `vista_inscripciones_activas`
--

DROP TABLE IF EXISTS `vista_inscripciones_activas`;
/*!50001 DROP VIEW IF EXISTS `vista_inscripciones_activas`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `vista_inscripciones_activas` AS SELECT 
 1 AS `inscripcion_id`,
 1 AS `alumno_id`,
 1 AS `dni`,
 1 AS `nombre_completo`,
 1 AS `deporte`,
 1 AS `plan`,
 1 AS `precio_mensual`,
 1 AS `estado`,
 1 AS `fecha_inscripcion`,
 1 AS `cantidad_horarios`*/;
SET character_set_client = @saved_cs_client;

--
-- Dumping events for database 'jaguares_db'
--

--
-- Dumping routines for database 'jaguares_db'
--

--
-- Current Database: `jaguares_db`
--

USE `jaguares_db`;

--
-- Final view structure for view `vista_horarios_completos`
--

/*!50001 DROP VIEW IF EXISTS `vista_horarios_completos`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `vista_horarios_completos` AS select `h`.`horario_id` AS `horario_id`,`d`.`nombre` AS `deporte`,`h`.`dia` AS `dia`,`h`.`hora_inicio` AS `hora_inicio`,`h`.`hora_fin` AS `hora_fin`,`h`.`cupo_maximo` AS `cupo_maximo`,`h`.`cupos_ocupados` AS `cupos_ocupados`,(`h`.`cupo_maximo` - `h`.`cupos_ocupados`) AS `cupos_disponibles`,`h`.`estado` AS `estado`,`h`.`categoria` AS `categoria`,`h`.`nivel` AS `nivel`,`h`.`genero` AS `genero`,`h`.`precio` AS `precio`,`h`.`plan` AS `plan`,`h`.`año_min` AS `año_min`,`h`.`año_max` AS `año_max` from (`horarios` `h` join `deportes` `d` on((`h`.`deporte_id` = `d`.`deporte_id`))) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `vista_inscripciones_activas`
--

/*!50001 DROP VIEW IF EXISTS `vista_inscripciones_activas`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `vista_inscripciones_activas` AS select `i`.`inscripcion_id` AS `inscripcion_id`,`a`.`alumno_id` AS `alumno_id`,`a`.`dni` AS `dni`,concat(`a`.`nombres`,' ',`a`.`apellido_paterno`,' ',`a`.`apellido_materno`) AS `nombre_completo`,`d`.`nombre` AS `deporte`,`i`.`plan` AS `plan`,`i`.`precio_mensual` AS `precio_mensual`,`i`.`estado` AS `estado`,`i`.`fecha_inscripcion` AS `fecha_inscripcion`,count(`ih`.`horario_id`) AS `cantidad_horarios` from (((`inscripciones` `i` join `alumnos` `a` on((`i`.`alumno_id` = `a`.`alumno_id`))) join `deportes` `d` on((`i`.`deporte_id` = `d`.`deporte_id`))) left join `inscripcion_horarios` `ih` on((`i`.`inscripcion_id` = `ih`.`inscripcion_id`))) where (`i`.`estado` = 'activa') group by `i`.`inscripcion_id`,`a`.`alumno_id`,`a`.`dni`,`a`.`nombres`,`a`.`apellido_paterno`,`a`.`apellido_materno`,`d`.`nombre`,`i`.`plan`,`i`.`precio_mensual`,`i`.`estado`,`i`.`fecha_inscripcion` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-01-19 21:56:13
