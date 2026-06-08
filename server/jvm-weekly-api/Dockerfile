FROM maven:3.9-eclipse-temurin-21 AS build

WORKDIR /workspace
COPY server/jvm-weekly-api/pom.xml ./pom.xml

COPY server/jvm-weekly-api/src ./src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:21-jre-alpine

WORKDIR /app
ENV WEEKLY_API_PORT=8080

RUN addgroup -S app && adduser -S app -G app

COPY --from=build /workspace/target/jvm-weekly-api-0.1.0-SNAPSHOT.jar /app/jvm-weekly-api.jar

EXPOSE 8080
USER app
ENTRYPOINT ["java", "-jar", "/app/jvm-weekly-api.jar"]
