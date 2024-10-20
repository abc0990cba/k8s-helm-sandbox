import React, { useState, useEffect, useRef } from "react";
import axios from "axios";

const Protected = ({ token }) => {
  const isRun = useRef(false);

  const [data, setData] = useState(null);

  useEffect(() => {
    if (isRun.current) return;

    isRun.current = true;

    const config = {
      headers: {
        authorization: `Bearer ${token}`,
      },
    };

    axios
      .get("/api/v1/values", config)
      .then((res) => { setData(res.data); console.log('docume', res.data)})
      .catch((err) => console.error(err));
  }, []);

  useEffect(() => {
    console.log('data', data)
  }, [data])

  return data ? (
    // <>
    //   {data.map((rec, i) => (
    //     <h3 key={i}>{rec}</h3>
    //   ))}
    // </>
    <div>Protected</div>
  ) : (
    <div>Protected</div>
  );
};

export default Protected;
