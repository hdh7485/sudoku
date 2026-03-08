FROM nginx:alpine
COPY index.html style.css puzzles.js app.js /usr/share/nginx/html/
EXPOSE 80
